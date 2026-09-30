import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requestHasValidSession, validOrigin } from "@/lib/auth";
import { updateWallet } from "@/lib/finance/service";
import { parseNonNegativeMoney } from "@/lib/finance/money";

const walletSchema = z.object({ name: z.string().trim().min(2).max(60), openingBalance: z.string().max(32) });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requestHasValidSession(request)) || !validOrigin(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  const parsed = walletSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Confira o nome e o saldo inicial." }, { status: 400 });
  const openingBalanceCents = parseNonNegativeMoney(parsed.data.openingBalance);
  if (openingBalanceCents === null) return NextResponse.json({ error: "Informe um saldo inicial válido de até R$ 1 bilhão." }, { status: 400 });
  const { id } = await params;
  try {
    await updateWallet({ id, ...parsed.data, openingBalanceCents });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível atualizar a carteira." }, { status: 404 });
  }
}
