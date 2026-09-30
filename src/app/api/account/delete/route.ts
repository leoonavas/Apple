import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser, validOrigin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const body = z.object({ confirmation: z.literal("EXCLUIR") }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Confirmação inválida." }, { status: 400 });

  const admin = createAdminClient();
  const { data: attachments, error: listError } = await admin.from("attachments").select("storage_path").eq("user_id", user.id);
  if (listError) return NextResponse.json({ error: "Não foi possível preparar a exclusão da conta." }, { status: 503 });
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return NextResponse.json({ error: "Não foi possível excluir a conta agora." }, { status: 503 });
  const paths = (attachments ?? []).map((row) => String(row.storage_path));
  if (paths.length) await admin.storage.from("finance-attachments").remove(paths).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
