import { NextRequest, NextResponse } from "next/server";
import { requestHasValidSession } from "@/lib/auth";
import { exportUserData } from "@/lib/finance/service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!(await requestHasValidSession(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const data = await exportUserData();
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(JSON.stringify(data), { headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="arcadya-dados-${date}.json"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    } });
  } catch {
    return NextResponse.json({ error: "Não foi possível exportar todos os seus dados." }, { status: 500 });
  }
}
