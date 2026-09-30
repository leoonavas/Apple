import { NextRequest, NextResponse } from "next/server";
import { requestHasValidSession } from "@/lib/auth";
import { getAttachment } from "@/lib/finance/service";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requestHasValidSession(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const { id } = await params;
  const file = await getAttachment(id);
  if (!file) return NextResponse.json({ error: "Anexo não encontrado." }, { status: 404 });
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("finance-attachments").createSignedUrl(file.storagePath, 60, { download: file.originalName });
  if (error || !data?.signedUrl) return NextResponse.json({ error: "Não foi possível abrir o anexo." }, { status: 404 });
  return NextResponse.redirect(data.signedUrl, { headers: { "cache-control": "private, no-store" } });
}
