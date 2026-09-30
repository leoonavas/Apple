import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requestHasValidSession, validOrigin } from "@/lib/auth";
import { transferWalletFunds } from "@/lib/finance/service";
import { parseTransactionAmount } from "@/lib/finance/money";

const transferSchema = z.object({
  fromWalletId: z.string().min(1).max(80),
  toWalletId: z.string().min(1).max(80),
  amount: z.string().max(32),
  description: z.string().trim().max(100).default("Transferência entre carteiras"),
});

export async function POST(request: NextRequest) {
  if (!(await requestHasValidSession(request)) || !validOrigin(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  const parsed = transferSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Confira as carteiras e o valor da transferência." }, { status: 400 });
  const amountCents = parseTransactionAmount(parsed.data.amount);
  if (!amountCents) return NextResponse.json({ error: "Informe um valor maior que zero e de até R$ 1 bilhão." }, { status: 400 });
  try {
    const transfer = await transferWalletFunds({ ...parsed.data, amountCents });
    return NextResponse.json({ id: transfer.id }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível concluir a transferência." }, { status: 400 });
  }
}
