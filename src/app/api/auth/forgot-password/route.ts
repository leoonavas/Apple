import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { validOrigin } from "@/lib/auth";

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  const body = z.object({ email: z.string().trim().email().max(254) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Informe um e-mail válido." }, { status: 400 });
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(body.data.email, {
    redirectTo: `${new URL(request.url).origin}/auth/confirm?next=/reset-password`,
  });
  if (error) return NextResponse.json({ error: "Não foi possível enviar o e-mail agora. Tente novamente mais tarde." }, { status: 503 });
  return NextResponse.json({ ok: true, message: "Se houver uma conta para esse e-mail, você receberá um link de recuperação." }, { status: 202 });
}
