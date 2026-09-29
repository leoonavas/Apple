import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

const COOKIE = "apple_session";
const SESSION_SECONDS = 60 * 60 * 24 * 14;

function sessionSecret() {
  const password = process.env.APP_ACCESS_PASSWORD;
  if (!password || password.length < 12) throw new Error("Configure APP_ACCESS_PASSWORD com pelo menos 12 caracteres em .env.local.");
  return process.env.APP_SESSION_SECRET ?? password;
}

function sign(expiresAt: number) {
  return createHmac("sha256", sessionSecret()).update(String(expiresAt)).digest("base64url");
}

export function isConfigured() {
  return Boolean(process.env.APP_ACCESS_PASSWORD && process.env.APP_ACCESS_PASSWORD.length >= 12);
}

export function passwordMatches(candidate: string) {
  const expected = process.env.APP_ACCESS_PASSWORD;
  if (!expected || expected.length < 12) return false;
  const left = createHmac("sha256", "apple-login").update(candidate).digest();
  const right = createHmac("sha256", "apple-login").update(expected).digest();
  return timingSafeEqual(left, right);
}

export async function setSessionCookie(request: NextRequest) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const jar = await cookies();
  const forwardedProto = request.headers.get("x-forwarded-proto");
  jar.set(COOKIE, `${expiresAt}.${sign(expiresAt)}`, {
    httpOnly: true,
    secure: forwardedProto === "https" || new URL(request.url).protocol === "https:",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(COOKIE, "", { httpOnly: true, secure: process.env.LOCAL_HTTPS === "1", sameSite: "strict", path: "/", maxAge: 0 });
}

export async function hasValidSession() {
  const token = (await cookies()).get(COOKIE)?.value;
  return validateToken(token);
}

export function requestHasValidSession(request: NextRequest) {
  return validateToken(request.cookies.get(COOKIE)?.value);
}

function validateToken(token?: string) {
  if (!token || !isConfigured()) return false;
  const [expiryRaw, actual] = token.split(".");
  const expiry = Number(expiryRaw);
  if (!Number.isSafeInteger(expiry) || expiry < Math.floor(Date.now() / 1000) || !actual) return false;
  try {
    const expected = Buffer.from(sign(expiry));
    const supplied = Buffer.from(actual);
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
  } catch { return false; }
}

export function validOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const requestHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
    ?? request.headers.get("host")
    ?? new URL(request.url).host;
  try { return new URL(origin).host === requestHost; }
  catch { return false; }
}
