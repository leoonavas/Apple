import { NextRequest, NextResponse } from "next/server";
import { getProcessingJob } from "@/lib/finance/service";
import { requestHasValidSession } from "@/lib/auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requestHasValidSession(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const { id } = await params;
    const job = await getProcessingJob(id);
    if (!job) return NextResponse.json({ error: "Processamento não encontrado." }, { status: 404 });
    return NextResponse.json({ status: job.status, error: job.error });
  } catch {
    return NextResponse.json({ error: "Não foi possível consultar o processamento." }, { status: 500 });
  }
}
