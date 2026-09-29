import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requestHasValidSession, validOrigin } from "@/lib/auth";
import { getCategories, resolveCategoryIds, updateTransaction, deleteTransaction } from "@/lib/finance/service";
import { parseMoney } from "@/lib/finance/money";
import { rawDb } from "@/lib/db";

const bodySchema = z.object({ direction: z.enum(["income", "expense"]), amount: z.string(), description: z.string().min(1).max(160), merchant: z.string().max(100).nullable(), occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), categories: z.array(z.string()).max(8) });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!requestHasValidSession(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (!validOrigin(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Confira os campos da movimentação." }, { status: 400 });
  const amountCents = parseMoney(parsed.data.amount);
  if (!amountCents) return NextResponse.json({ error: "O valor precisa ser maior que zero." }, { status: 400 });
  const allowed = getCategories().map((category) => category.name);
  const names = parsed.data.categories.filter((name) => allowed.includes(name));
  const categoryIds = resolveCategoryIds(names, parsed.data.merchant, names.join(" "));
  try {
    updateTransaction({ id, ...parsed.data, amountCents, categoryIds });
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível salvar." }, { status: 404 }); }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!requestHasValidSession(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (!validOrigin(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  const { id } = await params;
  const row = rawDb.prepare("SELECT source_message_id AS messageId FROM transactions WHERE id=?").get(id) as { messageId: string | null } | undefined;
  if (!row || !deleteTransaction(id)) return NextResponse.json({ error: "Movimentação não encontrada." }, { status: 404 });
  return NextResponse.json({ ok: true, messageId: row.messageId });
}
