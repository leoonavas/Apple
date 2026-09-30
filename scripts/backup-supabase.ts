import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { createWriteStream } from "node:fs";
import { appendFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const passphrase = process.env.BACKUP_PASSPHRASE;
if (!url || !serviceKey || !passphrase || passphrase.length < 20) throw new Error("Configure a URL, service key e BACKUP_PASSPHRASE com pelo menos 20 caracteres em .backup.env.");

const supabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const tables = ["categories", "wallets", "messages", "attachments", "wallet_transfers", "wallet_adjustments", "recurrence_rules", "transactions", "transaction_categories", "merchant_rules"];
const backupsDir = path.resolve(process.env.BACKUP_DIR ?? ".data/backups");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = path.join(backupsDir, `arcadya-${stamp}.jsonl.enc`);

async function* rows() {
  yield { kind: "meta", format: "arcadya-encrypted-backup-v1", createdAt: new Date().toISOString(), tables };
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Falha ao listar contas para o backup: ${error.message}`);
    for (const user of data.users) yield { kind: "user", id: user.id, email: user.email, phone: user.phone, emailConfirmed: Boolean(user.email_confirmed_at), phoneConfirmed: Boolean(user.phone_confirmed_at), userMetadata: user.user_metadata ?? {} };
    if (data.users.length < 1000) break;
  }
  const storage = supabase.storage.from("finance-attachments");
  for (const table of tables) {
    for (let offset = 0; ; offset += 1000) {
      const orderColumn = table === "transaction_categories" ? "transaction_id" : "id";
      const { data, error } = await supabase.from(table).select("*").order(orderColumn, { ascending: true }).range(offset, offset + 999);
      if (error) throw new Error(`Falha ao ler ${table} para o backup: ${error.message}`);
      for (const row of data ?? []) {
        yield { kind: "row", table, row };
        if (table === "attachments") {
          const { data: file, error: downloadError } = await storage.download(String(row.storage_path));
          if (downloadError || !file) throw new Error(`Falha ao baixar um anexo do backup (${String(row.id)}).`);
          const bytes = Buffer.from(await file.arrayBuffer());
          if (bytes.length !== Number(row.size)) throw new Error(`O tamanho do anexo ${String(row.id)} não confere.`);
          yield { kind: "file", userId: row.user_id, attachmentId: row.id, originalName: row.original_name, mimeType: row.mime_type, contentBase64: bytes.toString("base64") };
        }
      }
      if (!data || data.length < 1000) break;
    }
  }
  yield { kind: "complete", completedAt: new Date().toISOString() };
}

async function main() {
  await mkdir(backupsDir, { recursive: true, mode: 0o700 });
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase!, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const output = createWriteStream(destination, { flags: "wx", mode: 0o600 });
  try {
    await new Promise<void>((resolve, reject) => output.write(Buffer.concat([Buffer.from("ARCADYA1"), salt, iv]), (error) => error ? reject(error) : resolve()));
    const source = Readable.from((async function* () { for await (const row of rows()) yield `${JSON.stringify(row)}\n`; })());
    await pipeline(source, cipher, output);
    await appendFile(destination, cipher.getAuthTag(), { mode: 0o600 });
    process.stdout.write(`Backup criptografado criado: ${destination}\nGuarde a senha fora deste computador; sem ela, o backup não pode ser restaurado.\n`);
  } catch (error) {
    output.destroy();
    await rm(destination, { force: true });
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`Backup interrompido: ${error instanceof Error ? error.message : "falha inesperada"}\n`);
  process.exitCode = 1;
});
