import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AssistantIntent } from "@/lib/ai/schema";
import { completeAnalyzedMessage } from "@/lib/ai/processor";
import { createAdminClient } from "@/lib/supabase/server";
import { hasWorkerAuthorization } from "@/lib/worker-auth";

export const runtime = "nodejs";
export const maxDuration = 60;
const resultSchema = z.object({
  jobId: z.string().min(1).max(80),
  parsed: z.unknown(),
  extractedTexts: z.array(z.object({ attachmentId: z.string().min(1).max(80), text: z.string().max(100_000) })).max(4),
  errors: z.array(z.string().max(500)).max(4),
  usedLocalModel: z.boolean(),
});

export async function POST(request: NextRequest) {
  if (!hasWorkerAuthorization(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const size = Number(request.headers.get("content-length") ?? 0);
  if (size > 600_000) return NextResponse.json({ error: "Resultado excede o limite permitido." }, { status: 413 });
  const body = resultSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Resultado de processamento inválido." }, { status: 400 });
  let parsed;
  try { parsed = AssistantIntent.parse(body.data.parsed); }
  catch { return NextResponse.json({ error: "A interpretação retornada pelo worker não é válida." }, { status: 400 }); }

  const admin = createAdminClient();
  const { data: job, error } = await admin.from("processing_jobs").select("id,user_id,user_message_id,status,locked_until")
    .eq("id", body.data.jobId).maybeSingle();
  if (error) return NextResponse.json({ error: "Não foi possível verificar a tarefa." }, { status: 503 });
  if (!job || job.status !== "processing" || !job.locked_until || new Date(job.locked_until) <= new Date()) {
    return NextResponse.json({ error: "Tarefa expirada ou já concluída." }, { status: 409 });
  }
  try {
    await completeAnalyzedMessage(job.user_message_id, job.user_id, {
      parsed,
      extractedTexts: body.data.extractedTexts,
      errors: body.data.errors,
      usedLocalModel: body.data.usedLocalModel,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Não foi possível concluir o processamento." }, { status: 500 });
  }
}
