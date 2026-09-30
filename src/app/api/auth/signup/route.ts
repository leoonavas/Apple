import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { validOrigin } from "@/lib/auth";

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  const body = z.object({ email: z.string().trim().email().max(254), password: z.string().min(10).max(128) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Informe um e-mail válido e uma senha com pelo menos 10 caracteres." }, { status: 400 });
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: body.data.email,
    password: body.data.password,
    options: { emailRedirectTo: `${new URL(request.url).origin}/auth/confirm?next=/` },
  });
  if (error) return NextResponse.json({ error: "Não foi possível criar a conta. Confira os dados e tente novamente." }, { status: 400 });
  return NextResponse.json({ ok: true, message: "Se o cadastro foi aceito, enviaremos um link de confirmação para seu e-mail." }, { status: 202 });
}
