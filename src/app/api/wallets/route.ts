import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requestHasValidSession, validOrigin } from "@/lib/auth";
import { createWallet, listWallets } from "@/lib/finance/service";
import { parseNonNegativeMoney } from "@/lib/finance/money";

const walletSchema = z.object({
  name: z.string().trim().min(2).max(60),
  kind: z.enum(["checking", "savings", "investment"]),
  openingBalance: z.string().max(32),
});

export async function GET(request: NextRequest) {
  if (!requestHasValidSession(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  return NextResponse.json({ wallets: listWallets() });
}

export async function POST(request: NextRequest) {
  if (!requestHasValidSession(request) || !validOrigin(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  const parsed = walletSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Confira o nome, o tipo e o saldo inicial da carteira." }, { status: 400 });
  const openingBalanceCents = parseNonNegativeMoney(parsed.data.openingBalance);
  if (openingBalanceCents === null) return NextResponse.json({ error: "Informe um saldo inicial válido de até R$ 1 bilhão." }, { status: 400 });
  const id = createWallet({ ...parsed.data, openingBalanceCents });
  return NextResponse.json({ id }, { status: 201 });
}
