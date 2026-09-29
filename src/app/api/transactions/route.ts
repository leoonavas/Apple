import { NextRequest, NextResponse } from "next/server";
import { requestHasValidSession } from "@/lib/auth";
import { listTransactions } from "@/lib/finance/service";

export async function GET(request: NextRequest) {
  if (!requestHasValidSession(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  return NextResponse.json({ transactions: listTransactions() });
}
