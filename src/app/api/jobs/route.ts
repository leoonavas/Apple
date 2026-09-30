import { NextRequest, NextResponse } from "next/server";
import { requestHasValidSession } from "@/lib/auth";
import { listPendingProcessingJobs } from "@/lib/finance/service";

export async function GET(request: NextRequest) {
  if (!(await requestHasValidSession(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  return NextResponse.json({ jobs: await listPendingProcessingJobs() });
}
