import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

function config() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  return { url, key };
}

export async function createClient() {
  const jar = await cookies();
  const { url, key } = config();
  return createServerClient(url, key, {
    cookies: {
      getAll() { return jar.getAll(); },
      setAll(values) {
        try { for (const { name, value, options } of values) jar.set(name, value, options); }
        catch { /* Server Components cannot write cookies; proxy.ts refreshes sessions. */ }
      },
    },
  });
}

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no servidor.");
  // This client is server-only and is reserved for authenticated internal worker jobs and migration scripts.
  return createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
