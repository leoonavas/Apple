import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { validOrigin } from "@/lib/auth";

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  const body = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(128) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Informe um e-mail e uma senha válidos." }, { status: 400 });
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(body.data);
  if (error) return NextResponse.json({ error: "E-mail ou senha incorretos. Se acabou de criar a conta, confirme seu e-mail." }, { status: 401 });
  return NextResponse.json({ ok: true });
}
