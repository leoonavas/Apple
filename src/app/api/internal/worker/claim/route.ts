import { NextRequest, NextResponse } from "next/server";
import { getCategories, getRecentContext, listWallets } from "@/lib/finance/service";
import { withPrivilegedUser } from "@/lib/supabase/data-context";
import { createAdminClient } from "@/lib/supabase/server";
import { hasWorkerAuthorization } from "@/lib/worker-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!hasWorkerAuthorization(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_processing_job");
  if (error) return NextResponse.json({ error: "Não foi possível buscar uma tarefa." }, { status: 503 });
  const job = (Array.isArray(data) ? data[0] : data) as { id: string; user_id: string; user_message_id: string } | null;
  if (!job) return new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });

  try {
  const [{ data: message, error: messageError }, { data: attachments, error: attachmentError }, context] = await Promise.all([
    admin.from("messages").select("content").eq("user_id", job.user_id).eq("id", job.user_message_id).eq("role", "user").maybeSingle(),
    admin.from("attachments").select("id,original_name,mime_type,size,storage_path").eq("user_id", job.user_id).eq("message_id", job.user_message_id),
    withPrivilegedUser(job.user_id, async () => Promise.all([getCategories(), listWallets(), getRecentContext(job.user_message_id)])),
  ]);
  if (messageError || attachmentError || !message) {
    await admin.from("processing_jobs").update({ status: "failed", error: "A mensagem ou os anexos da tarefa não estão disponíveis.", locked_until: null, updated_at: new Date().toISOString() }).eq("id", job.id);
    return NextResponse.json({ error: "A mensagem da tarefa não está disponível." }, { status: 409 });
  }

  const files = await Promise.all((attachments ?? []).map(async (file) => {
    const { data: signed, error: signError } = await admin.storage.from("finance-attachments").createSignedUrl(file.storage_path, 300);
    if (signError || !signed?.signedUrl) throw new Error("Não foi possível liberar temporariamente um anexo ao worker.");
    return { id: file.id, originalName: file.original_name, mimeType: file.mime_type, size: Number(file.size), url: signed.signedUrl };
  }));
  const [categories, wallets, history] = context;
  return NextResponse.json({
    jobId: job.id,
    messageId: job.user_message_id,
    userText: message.content,
    attachments: files,
    categories: categories.map((category) => category.name),
    wallets,
    history,
  }, { headers: { "cache-control": "no-store" } });
  } catch {
    await admin.from("processing_jobs").update({ status: "failed", error: "Não foi possível preparar a tarefa para o processador local.", locked_until: null, updated_at: new Date().toISOString() }).eq("id", job.id);
    return NextResponse.json({ error: "Não foi possível preparar a tarefa." }, { status: 503 });
  }
}
