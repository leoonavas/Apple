import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, validOrigin } from "@/lib/auth";
import { addMessage, createMessageJob, deleteMessage, findAttachmentByHashes, getAttachmentUsage, listMessages, saveAttachment } from "@/lib/finance/service";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;
const MAX_FILE = 20 * 1024 * 1024;
const MAX_REQUEST = 30 * 1024 * 1024;
const MAX_STORED = 30 * 1024 * 1024;
const MAX_MONTHLY_PROCESSED = 100 * 1024 * 1024;
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav"]);
const EXTENSIONS: Record<string, string> = { "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic", "audio/webm": ".webm", "audio/ogg": ".ogg", "audio/mp4": ".m4a", "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav" };

export async function GET(request: NextRequest) {
  if (!(await getAuthenticatedUser())) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try { return NextResponse.json({ messages: await listMessages() }); }
  catch { return NextResponse.json({ error: "Não foi possível carregar as mensagens." }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (!validOrigin(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  const requestSize = Number(request.headers.get("content-length") ?? 0);
  if (requestSize > MAX_REQUEST + 1024 * 1024) return NextResponse.json({ error: "O tamanho total da mensagem excede 30 MB." }, { status: 413 });
  let form: FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ error: "Não consegui ler o formulário enviado." }, { status: 400 }); }
  const content = String(form.get("content") ?? "").trim().slice(0, 5000);
  const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
  if (!content && !files.length) return NextResponse.json({ error: "Escreva uma mensagem ou anexe um arquivo." }, { status: 400 });
  if (files.length > 4) return NextResponse.json({ error: "Envie no máximo quatro arquivos por mensagem." }, { status: 400 });
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_REQUEST) return NextResponse.json({ error: "O tamanho combinado dos anexos excede 30 MB." }, { status: 413 });
  for (const file of files) {
    const mime = file.type.split(";")[0].toLowerCase();
    if (!ALLOWED.has(mime)) return NextResponse.json({ error: `Formato não aceito: ${file.name}` }, { status: 415 });
    if (file.size > MAX_FILE) return NextResponse.json({ error: `O arquivo ${file.name} excede 20 MB.` }, { status: 413 });
  }

  const validFiles: Array<{ file: File; mime: string; buffer: Buffer; sha256: string }> = [];
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const mime = file.type.split(";")[0].toLowerCase();
    if (!matchesMagic(buffer, mime)) return NextResponse.json({ error: `O conteúdo do arquivo ${file.name} não corresponde ao formato informado.` }, { status: 415 });
    validFiles.push({ file, mime, buffer, sha256: createHash("sha256").update(buffer).digest("hex") });
  }
  const duplicate = await findAttachmentByHashes(validFiles.map(({ sha256 }) => sha256));
  if (duplicate) return NextResponse.json({ error: `“${duplicate.original_name}” já foi enviado e está ligado ao histórico.` }, { status: 409 });
  const usage = await getAttachmentUsage();
  const incoming = validFiles.reduce((sum, entry) => sum + entry.file.size, 0);
  if (usage.stored + incoming > MAX_STORED) return NextResponse.json({ error: "Seu limite de armazenamento de anexos da beta é 30 MB." }, { status: 413 });
  if (usage.processedThisMonth + incoming > MAX_MONTHLY_PROCESSED) return NextResponse.json({ error: "Você atingiu o limite mensal de processamento de anexos da beta (100 MB)." }, { status: 429 });

  const supabase = await createClient();
  const messageId = randomUUID();
  const uploadedPaths: string[] = [];
  try {
    await addMessage("user", content || "Anexo enviado.", null, messageId);
    for (const { file, mime, buffer, sha256 } of validFiles) {
      const id = randomUUID();
      const storagePath = `${user.id}/${messageId}/${id}${EXTENSIONS[mime]}`;
      const { error } = await supabase.storage.from("finance-attachments").upload(storagePath, buffer, { contentType: mime, cacheControl: "0", upsert: false });
      if (error) throw new Error(error.message);
      uploadedPaths.push(storagePath);
      await saveAttachment({ id, messageId, originalName: file.name.slice(0, 180), mimeType: mime, size: file.size, sha256, storagePath });
    }
    const jobId = await createMessageJob(messageId);
    return NextResponse.json({ messageId, jobId, status: "queued" }, { status: 202 });
  } catch (error) {
    await supabase.storage.from("finance-attachments").remove(uploadedPaths).catch(() => undefined);
    await deleteMessage(messageId).catch(() => undefined);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao enviar a mensagem." }, { status: 500 });
  }
}

function matchesMagic(buffer: Buffer, mime: string) {
  if (mime === "application/pdf") return buffer.subarray(0, 5).toString() === "%PDF-";
  if (mime === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/webp") return buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
  if (mime === "image/heic") return buffer.subarray(4, 12).toString().includes("ftyp");
  if (mime === "audio/webm") return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (mime === "audio/ogg") return buffer.subarray(0, 4).toString() === "OggS";
  if (mime === "audio/mp4") return buffer.subarray(4, 8).toString() === "ftyp";
  if (mime === "audio/mpeg") return buffer.subarray(0, 3).toString() === "ID3" || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
  if (mime === "audio/wav" || mime === "audio/x-wav") return buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WAVE";
  return false;
}
