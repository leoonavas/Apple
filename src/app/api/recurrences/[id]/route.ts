import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requestHasValidSession, validOrigin } from "@/lib/auth";
import { deleteRecurrence, getCategories, resolveCategoryIds, toggleRecurrence, updateRecurrence } from "@/lib/finance/service";
import { parseMoney } from "@/lib/finance/money";

const recurrenceSchema = z.object({ name: z.string().trim().min(2).max(100), direction: z.enum(["income", "expense"]), amount: z.string(), merchant: z.string().max(100).nullable(), description: z.string().trim().min(1).max(160), frequency: z.enum(["weekly", "monthly", "yearly"]), startOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), categories: z.array(z.string()).max(8) }).refine((value) => !value.endOn || value.endOn >= value.startOn, { path: ["endOn"], message: "A data final deve ser igual ou posterior à data inicial." });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requestHasValidSession(request)) || !validOrigin(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  const payload = await request.json().catch(() => null);
  const body = z.union([z.object({ active: z.boolean() }), recurrenceSchema]).safeParse(payload);
  if (!body.success) return NextResponse.json({ error: "Estado inválido." }, { status: 400 });
  const { id } = await params;
  try {
    if ("active" in body.data) await toggleRecurrence(id, body.data.active);
    else {
      const amountCents = parseMoney(body.data.amount);
      if (!amountCents) return NextResponse.json({ error: "O valor precisa ser maior que zero." }, { status: 400 });
      const categories = await getCategories();
      const names = body.data.categories.filter((name) => categories.some((category) => category.name === name));
      const categoryIds = await resolveCategoryIds(names, body.data.merchant, names.join(" "));
      await updateRecurrence({ id, ...body.data, amountCents, categoryIds });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const missing = error instanceof Error && error.message.includes("não encontrada");
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível atualizar a recorrência." }, { status: missing ? 404 : 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requestHasValidSession(request)) || !validOrigin(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  const { id } = await params;
  if (!(await deleteRecurrence(id))) return NextResponse.json({ error: "Recorrência não encontrada." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
