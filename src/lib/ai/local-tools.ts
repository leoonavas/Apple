import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AssistantIntent } from "./schema";
import { FINANCE_ASSISTANT_POLICY } from "./skills";

const execFileAsync = promisify(execFile);
const maxOutput = 5 * 1024 * 1024;
let appleMediaBuild: Promise<string> | null = null;

async function command(name: string, args: string[]) {
  return execFileAsync(name, args, { timeout: 120_000, maxBuffer: maxOutput, encoding: "utf8" });
}

async function ocrImage(filePath: string): Promise<string> {
  const { stdout } = await command("tesseract", [filePath, "stdout", "-l", "por+eng", "--psm", "6"]);
  return stdout.trim();
}

async function runAppleMedia(operation: string, filePath: string) {
  if (process.platform !== "darwin") throw new Error("OCR nativo do macOS não está disponível.");
  const binary = path.resolve(/*turbopackIgnore: true*/ ".data/bin/apple-media");
  if (!appleMediaBuild) {
    appleMediaBuild = (async () => {
      await fs.mkdir(path.dirname(binary), { recursive: true, mode: 0o700 });
      try { await fs.access(binary); }
      catch {
        await command("swiftc", [
          path.resolve("scripts/apple-media.swift"), "-o", binary,
          "-framework", "AppKit", "-framework", "PDFKit", "-framework", "Vision",
        ]);
        await fs.chmod(binary, 0o700);
      }
      return binary;
    })().catch((error) => { appleMediaBuild = null; throw error; });
  }
  const executable = await appleMediaBuild;
  const { stdout } = await command(executable, [operation, filePath]);
  return stdout.trim();
}

export async function extractAttachmentText(filePath: string, mimeType: string): Promise<string> {
  if (mimeType === "application/pdf") {
    try {
      const { stdout } = await command("pdftotext", ["-layout", filePath, "-"]);
      if (stdout.trim().length > 15) return stdout.trim();
    } catch { /* Try the local macOS Vision/PDFKit implementation below. */ }
    if (process.platform === "darwin") return runAppleMedia("ocr", filePath);
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "apple-pdf-"));
    try {
      const prefix = path.join(temporary, "page");
      await command("pdftoppm", ["-f", "1", "-l", "5", "-r", "200", "-png", filePath, prefix]);
      const pages = (await fs.readdir(temporary)).filter((name) => name.endsWith(".png")).sort();
      const text = await Promise.all(pages.map((name) => ocrImage(path.join(temporary, name)).catch(() => "")));
      return text.filter(Boolean).join("\n\n");
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }
  if (mimeType.startsWith("image/")) {
    if (process.platform === "darwin") return runAppleMedia("ocr", filePath);
    const imagePath = mimeType === "image/heic" ? await convertHeic(filePath) : filePath;
    try { return await ocrImage(imagePath); }
    finally { if (imagePath !== filePath) await fs.rm(imagePath, { force: true }); }
  }
  return "";
}

async function convertHeic(source: string): Promise<string> {
  const destination = path.join(os.tmpdir(), `apple-${randomUUID()}.jpg`);
  await command("sips", ["-s", "format", "jpeg", source, "--out", destination]);
  return destination;
}

export async function transcribeAudio(filePath: string): Promise<string> {
  const wav = path.join(os.tmpdir(), `apple-${randomUUID()}.wav`);
  const model = path.resolve(/*turbopackIgnore: true*/ process.env.WHISPER_MODEL ?? "./models/ggml-medium-q5_0.bin");
  let input = filePath;
  try {
    if (process.platform === "darwin") {
      try {
        await command("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", filePath, wav]);
        input = wav;
      } catch {
        if (!filePath.toLowerCase().endsWith(".wav")) throw new Error("Para transcrever esse formato, instale o FFmpeg localmente.");
      }
    } else {
      await command("ffmpeg", ["-y", "-i", filePath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
      input = wav;
    }
    const bundledWhisper = path.resolve(/*turbopackIgnore: true*/ ".data/bin/whisper-cli");
    let whisperExecutable = "whisper-cli";
    try { await fs.access(bundledWhisper); whisperExecutable = bundledWhisper; } catch { /* Use a system installation if present. */ }
    const prompt = "Português brasileiro sobre finanças pessoais e carteiras. Termos comuns: gastei, paguei, comprei, recebi, guardei, poupança, poupei, investi, carteira, saldo, transferência, conta corrente, reais, salário, mercado, Mercado Livre, entrada e saída.";
    const { stdout } = await command(whisperExecutable, ["-m", model, "-f", input, "-l", "pt", "-bs", "8", "--prompt", prompt, "-nt"]);
    return stdout.trim();
  } finally {
    await fs.rm(wav, { force: true });
  }
}

export async function callVisionModel(text: string, imagePaths: string[], categories: string[], history: string, wallets: string[] = []) {
  const imageParts = await Promise.all(imagePaths.map(async (image) => fs.readFile(image).then((buffer) => buffer.toString("base64"))));
  return callModel(text, imageParts, categories, history, wallets);
}

export async function callTextModel(text: string, categories: string[], history: string, wallets: string[] = []) {
  return callModel(text, [], categories, history, wallets);
}

async function callModel(text: string, images: string[], categories: string[], history: string, wallets: string[]) {
  const endpoint = new URL("/api/chat", process.env.OLLAMA_URL ?? "http://127.0.0.1:11434");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(150_000),
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL ?? "gemma3:4b",
      stream: false,
      format: z.toJSONSchema(AssistantIntent),
      options: { temperature: 0, num_ctx: 8192 },
      messages: [
        { role: "system", content: `${FINANCE_ASSISTANT_POLICY}\n\nCampos do retorno: intent, transactions, recurrence, report, adviceTopic, clarification e wallet. Cada movimentação inclui direction, amount, occurredOn, merchant, description, categories, confidence e evidence. Recurrence inclui name, direction, amount, merchant, description, frequency, startOn, endOn e categories. Report inclui period, start, end, categories e groupBy. Wallet inclui action, walletName, walletKind, sourceWalletName, sourceWalletKind, amount, newName e description.` },
        { role: "user", content: `Contexto recente:\n${history || "(novo pedido)"}\n\nCategorias permitidas: ${categories.join(", ")}\n\nCarteiras existentes (nome, tipo, saldo atual):\n${wallets.length ? wallets.join("\n") : "(nenhuma)"}\n\nPedido e texto extraído de anexos:\n${text}${images.length ? "\n\nAnexos de imagem incluídos." : ""}` , images },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Ollama respondeu ${response.status}`);
  const payload = await response.json() as { message?: { content?: string } };
  if (!payload.message?.content) throw new Error("Ollama não retornou conteúdo.");
  return payload.message.content;
}
