import "server-only";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function getAuthenticatedUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user;
}

export async function hasValidSession() {
  return Boolean(await getAuthenticatedUser());
}

export async function requestHasValidSession(_request: NextRequest) {
  return Boolean(await getAuthenticatedUser());
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
