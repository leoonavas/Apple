import { NextRequest, NextResponse } from "next/server";
import { requestHasValidSession } from "@/lib/auth";
import { report } from "@/lib/finance/service";

export async function GET(request: NextRequest) {
  if (!(await requestHasValidSession(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const periodRaw = params.get("period") ?? "month";
  const period = ["today", "week", "month", "all"].includes(periodRaw) ? periodRaw as "today" | "week" | "month" | "all" : "month";
  const groupByRaw = params.get("groupBy");
  const groupBy = ["day", "week", "month", "category"].includes(groupByRaw ?? "") ? groupByRaw as "day" | "week" | "month" | "category" : null;
  return NextResponse.json(await report({ period, categoryNames: params.getAll("category"), groupBy }));
}
