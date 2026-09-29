import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { attachmentsDir, rawDb } from "@/lib/db";
import { requestHasValidSession, validOrigin } from "@/lib/auth";
import { addMessage, listMessages, saveAttachment } from "@/lib/finance/service";
import { processUserMessage } from "@/lib/ai/processor";

export const runtime = "nodejs";
export const maxDuration = 300;
const MAX_FILE = 20 * 1024 * 1024;
const MAX_TOTAL = 30 * 1024 * 1024;
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav"]);
const EXTENSIONS: Record<string, string> = { "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic", "audio/webm": ".webm", "audio/ogg": ".ogg", "audio/mp4": ".m4a", "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav" };

export async function GET(request: NextRequest) {
  if (!requestHasValidSession(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  return NextResponse.json({ messages: listMessages() });
}

export async function POST(request: NextRequest) {
  if (!requestHasValidSession(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  if (!validOrigin(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  const requestSize = Number(request.headers.get("content-length") ?? 0);
  if (requestSize > MAX_TOTAL + 1024 * 1024) return NextResponse.json({ error: "O tamanho total da mensagem excede 30 MB." }, { status: 413 });
  let form: FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ error: "Não consegui ler o formulário enviado." }, { status: 400 }); }
  const content = String(form.get("content") ?? "").trim().slice(0, 5000);
  const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
  if (!content && !files.length) return NextResponse.json({ error: "Escreva uma mensagem ou anexe um arquivo." }, { status: 400 });
  if (files.length > 4) return NextResponse.json({ error: "Envie no máximo quatro arquivos por mensagem." }, { status: 400 });
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL) return NextResponse.json({ error: "O tamanho combinado dos anexos excede 30 MB." }, { status: 413 });
  for (const file of files) {
    const mime = file.type.split(";")[0].toLowerCase();
    if (!ALLOWED.has(mime)) return NextResponse.json({ error: `Formato não aceito: ${file.name}` }, { status: 415 });
    if (file.size > MAX_FILE) return NextResponse.json({ error: `O arquivo ${file.name} excede 20 MB.` }, { status: 413 });
  }
  const fileResults = await Promise.allSettled(files.map(async (file) => {
    const buffer = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const mime = file.type.split(";")[0].toLowerCase();
    if (!matchesMagic(buffer, mime)) throw new Error(`O conteúdo do arquivo ${file.name} não corresponde ao formato informado.`);
    return { file, mime, buffer, sha256 };
  }));
  const invalid = fileResults.find((entry) => entry.status === "rejected");
  if (invalid?.status === "rejected") return NextResponse.json({ error: invalid.reason instanceof Error ? invalid.reason.message : "Arquivo inválido." }, { status: 415 });
  const validFiles = fileResults.flatMap((entry) => entry.status === "fulfilled" ? [entry.value] : []);
  const duplicate = validFiles.find(({ sha256 }) => rawDb.prepare("SELECT id FROM attachments WHERE sha256=?").get(sha256));
  if (duplicate) return NextResponse.json({ error: `“${duplicate.file.name}” já foi enviado e está ligado ao histórico.` }, { status: 409 });

  const messageId = randomUUID();
  const written: string[] = [];
  try {
    addMessage("user", content || "Anexo enviado.", null, messageId);
    for (const { file, mime, buffer, sha256 } of validFiles) {
      const id = randomUUID();
      const diskPath = path.join(/*turbopackIgnore: true*/ attachmentsDir, `${id}${EXTENSIONS[mime]}`);
      await fs.writeFile(diskPath, buffer, { flag: "wx", mode: 0o600 });
      written.push(diskPath);
      saveAttachment({ id, messageId, originalName: file.name.slice(0, 180), mimeType: mime, size: file.size, sha256, diskPath, extractedText: "" });
    }
    const jobId = randomUUID();
    rawDb.prepare("INSERT INTO processing_jobs(id,user_message_id,status,created_at,updated_at) VALUES(?,?,'processing',?,?)").run(jobId, messageId, Date.now(), Date.now());
    const reply = await processUserMessage(messageId);
    return NextResponse.json({ messageId, reply, messages: listMessages() }, { status: 201 });
  } catch (error) {
    await Promise.all(written.map((file) => fs.rm(file, { force: true }).catch(() => undefined)));
    rawDb.prepare("DELETE FROM messages WHERE id=?").run(messageId);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha no processamento." }, { status: 500 });
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
