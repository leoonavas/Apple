import { NextRequest, NextResponse } from "next/server";
import { isConfigured, passwordMatches, setSessionCookie, validOrigin } from "@/lib/auth";

export const runtime = "nodejs";
const attempts = new Map<string, { count: number; since: number }>();

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  if (!isConfigured()) return NextResponse.json({ error: "Defina APP_ACCESS_PASSWORD com pelo menos 12 caracteres em .env.local e reinicie o app." }, { status: 503 });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now();
  const attempt = attempts.get(ip);
  if (attempt && now - attempt.since < 10 * 60_000 && attempt.count >= 10) return NextResponse.json({ error: "Muitas tentativas. Aguarde alguns minutos." }, { status: 429 });
  const body = await request.json().catch(() => null) as { password?: string } | null;
  if (!body?.password || !passwordMatches(body.password)) {
    attempts.set(ip, attempt && now - attempt.since < 10 * 60_000 ? { count: attempt.count + 1, since: attempt.since } : { count: 1, since: now });
    return NextResponse.json({ error: "Senha incorreta." }, { status: 401 });
  }
  attempts.delete(ip);
  await setSessionCookie(request);
  return NextResponse.json({ ok: true });
}
