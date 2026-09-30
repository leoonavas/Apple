import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { hasWorkerAuthorization } from "@/lib/worker-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!hasWorkerAuthorization(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const body = z.object({ jobId: z.string().min(1).max(80) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Tarefa inválida." }, { status: 400 });
  const { data, error } = await createAdminClient().from("processing_jobs")
    .update({ status: "failed", error: "O processador local não conseguiu concluir esta mensagem.", locked_until: null, updated_at: new Date().toISOString() })
    .eq("id", body.data.jobId).eq("status", "processing").select("id");
  if (error) return NextResponse.json({ error: "Não foi possível atualizar a tarefa." }, { status: 503 });
  if (!data?.length) return NextResponse.json({ error: "Tarefa expirada ou já concluída." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
