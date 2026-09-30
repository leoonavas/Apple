import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { analyzeLocalMessage } from "../src/lib/ai/analyzer";
import type { WalletView } from "../src/lib/finance/service";

type Task = {
  jobId: string;
  messageId: string;
  userText: string;
  attachments: Array<{ id: string; originalName: string; mimeType: string; size: number; url: string }>;
  categories: string[];
  wallets: WalletView[];
  history: string;
};

const baseUrl = (process.env.WORKER_URL ?? "https://app.arcadya.cc").replace(/\/$/, "");
const token = process.env.WORKER_TOKEN;
if (!token || token.length < 32) throw new Error("Defina WORKER_TOKEN (mínimo de 32 caracteres) no .env.local deste computador.");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const authorization = { authorization: `Bearer ${token}` };

async function claim(): Promise<Task | null> {
  const response = await fetch(`${baseUrl}/api/internal/worker/claim`, { method: "POST", headers: authorization, signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`claim respondeu HTTP ${response.status}`);
  return response.json() as Promise<Task>;
}

async function processTask(task: Task) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), `arcadya-worker-${randomUUID()}-`));
  try {
    const downloaded: Array<{ id: string; originalName: string; mimeType: string; filePath: string }> = [];
    const errors: string[] = [];
    for (const attachment of task.attachments) {
      try {
        const response = await fetch(attachment.url, { signal: AbortSignal.timeout(120_000), cache: "no-store" });
        if (!response.ok) throw new Error(`download HTTP ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length !== attachment.size || bytes.length > 20 * 1024 * 1024) throw new Error("tamanho do anexo inválido");
        const extension = path.extname(attachment.originalName).toLowerCase();
        const safeExtension = /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : "";
        const filePath = path.join(temporary, `${attachment.id}${safeExtension}`);
        await fs.writeFile(filePath, bytes, { mode: 0o600, flag: "wx" });
        downloaded.push({ id: attachment.id, originalName: attachment.originalName, mimeType: attachment.mimeType, filePath });
      } catch (error) {
        errors.push(`${attachment.originalName}: ${error instanceof Error ? error.message : "falha ao baixar anexo"}`);
      }
    }
    const analysis = await analyzeLocalMessage({
      userText: task.userText,
      attachments: downloaded,
      categories: task.categories,
      wallets: task.wallets,
      history: task.history,
    });
    const response = await fetch(`${baseUrl}/api/internal/worker/complete`, {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({ jobId: task.jobId, ...analysis, errors: [...errors, ...analysis.errors].slice(0, 4) }),
      signal: AbortSignal.timeout(75_000),
    });
    if (!response.ok) throw new Error(`complete respondeu HTTP ${response.status}`);
    process.stdout.write(`Tarefa concluída ${task.jobId}\n`);
  } catch (error) {
    await fetch(`${baseUrl}/api/internal/worker/fail`, {
      method: "POST", headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({ jobId: task.jobId }), signal: AbortSignal.timeout(15_000),
    }).catch(() => undefined);
    throw error;
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

process.stdout.write(`Worker local conectado a ${baseUrl}; sem chave de banco no computador.\n`);
while (true) {
  try {
    const task = await claim();
    if (!task) { await sleep(3000); continue; }
    process.stdout.write(`Processando tarefa ${task.jobId}\n`);
    await processTask(task);
  } catch (error) {
    process.stderr.write(`Worker: ${error instanceof Error ? error.message : "falha inesperada"}\n`);
    await sleep(5000);
  }
}
