import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { validOrigin } from "@/lib/auth";

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  const body = z.object({ password: z.string().min(10).max(128) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "A senha precisa ter pelo menos 10 caracteres." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "O link expirou. Solicite uma nova recuperação de senha." }, { status: 401 });
  const { error } = await supabase.auth.updateUser({ password: body.data.password });
  if (error) return NextResponse.json({ error: "Não foi possível atualizar a senha." }, { status: 400 });
  return NextResponse.json({ ok: true });
}
