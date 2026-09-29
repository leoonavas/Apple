import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, requestHasValidSession, validOrigin } from "@/lib/auth";

export async function POST(request: NextRequest) {
  if (!validOrigin(request) || !requestHasValidSession(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
