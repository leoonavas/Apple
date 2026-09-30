import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validOrigin } from "@/lib/auth";

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
