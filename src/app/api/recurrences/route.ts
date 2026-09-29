import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requestHasValidSession, validOrigin } from "@/lib/auth";
import { createRecurrence, getCategories, listRecurrences, resolveCategoryIds } from "@/lib/finance/service";
import { parseMoney } from "@/lib/finance/money";

const schema = z.object({ name: z.string().min(2).max(100), direction: z.enum(["income", "expense"]), amount: z.string(), merchant: z.string().max(100).nullable(), description: z.string().min(1).max(160), frequency: z.enum(["weekly", "monthly", "yearly"]), startOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), categories: z.array(z.string()).max(8) }).refine((value) => !value.endOn || value.endOn >= value.startOn, { path: ["endOn"], message: "A data final deve ser igual ou posterior à data inicial." });

export async function GET(request: NextRequest) {
  if (!requestHasValidSession(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  return NextResponse.json({ recurrences: listRecurrences(), categories: getCategories() });
}

export async function POST(request: NextRequest) {
  if (!requestHasValidSession(request) || !validOrigin(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Confira os campos da recorrência." }, { status: 400 });
  const amountCents = parseMoney(body.data.amount);
  if (!amountCents) return NextResponse.json({ error: "O valor precisa ser maior que zero." }, { status: 400 });
  const names = body.data.categories.filter((name) => getCategories().some((category) => category.name === name));
  const categoryIds = resolveCategoryIds(names, body.data.merchant, names.join(" "));
  const id = createRecurrence({ ...body.data, amountCents, categoryIds });
  return NextResponse.json({ id }, { status: 201 });
}
