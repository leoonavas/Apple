import { createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const passphrase = process.env.BACKUP_PASSPHRASE;
const source = path.resolve(process.argv[2] ?? "");
if (process.env.RESTORE_CONFIRM !== "RESTORE") throw new Error("Para evitar restauração acidental, defina RESTORE_CONFIRM=RESTORE.");
if (!url || !serviceKey || !passphrase || passphrase.length < 20 || !process.argv[2]) throw new Error("Passe o arquivo .jsonl.enc e configure URL, service key e a senha em .backup.env.");

const supabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
type AnyRow = Record<string, any>;
const required = <T>(result: { data: T | null; error: { message: string } | null }): T => {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
};
const categoryIds = new Map<string, Map<string, string>>();
const walletIds = new Map<string, Map<string, string>>();
const userIds = new Map<string, string>();
const attachmentPaths = new Map<string, string>();
let createdUsersNeedingReset = 0;

async function decryptBackup() {
  const file = await open(source, "r");
  const stat = await file.stat();
  if (stat.size < 52) { await file.close(); throw new Error("O arquivo de backup está incompleto."); }
  const header = Buffer.alloc(36);
  const tag = Buffer.alloc(16);
  try {
    await file.read(header, 0, header.length, 0);
    await file.read(tag, 0, tag.length, stat.size - tag.length);
  } finally { await file.close(); }
  if (header.subarray(0, 8).toString() !== "ARCADYA1") throw new Error("Formato de backup desconhecido.");
  const key = scryptSync(passphrase!, header.subarray(8, 24), 32);
  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(24, 36));
  decipher.setAuthTag(tag);
  const temporary = path.join(os.tmpdir(), `arcadya-restore-${randomBytes(12).toString("hex")}.jsonl`);
  try {
    await pipeline(createReadStream(source, { start: 36, end: stat.size - 17 }), decipher, createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
    return temporary;
  } catch {
    await rm(temporary, { force: true });
    throw new Error("Não consegui autenticar o backup. Confira a senha e o arquivo.");
  }
}

async function destinationUser(oldId: string, email: string, phone: string | null, emailConfirmed: boolean, phoneConfirmed: boolean, userMetadata: unknown) {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`Não consegui consultar usuários de destino: ${error.message}`);
  let user = data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    const temporaryPassword = randomBytes(32).toString("base64url");
    const created = await supabase.auth.admin.createUser({
      email, password: temporaryPassword, email_confirm: emailConfirmed,
      ...(phone ? { phone, phone_confirm: phoneConfirmed } : {}),
      user_metadata: userMetadata as Record<string, unknown>,
    });
    if (created.error || !created.data.user) throw new Error(`Não consegui recriar uma conta: ${created.error?.message ?? "sem resposta do Supabase"}`);
    user = created.data.user;
    createdUsersNeedingReset += 1;
  }
  userIds.set(oldId, user.id);
  categoryIds.set(oldId, new Map());
  walletIds.set(oldId, new Map());
  return user.id;
}

async function restoreRow(table: string, sourceRow: AnyRow) {
  const oldUserId = String(sourceRow.user_id);
  const userId = userIds.get(oldUserId);
  if (!userId) throw new Error(`O backup contém um registro sem usuário mapeado (${table}).`);
  const row: AnyRow = { ...sourceRow, user_id: userId };
  const cats = categoryIds.get(oldUserId)!;
  const wallets = walletIds.get(oldUserId)!;

  if (table === "categories") {
    const categoryLookup = await supabase.from("categories").select("id,name").eq("user_id", userId).eq("name", row.name).maybeSingle();
    if (categoryLookup.error) throw new Error(categoryLookup.error.message);
    const existing = categoryLookup.data as { id: string; name: string } | null;
    const id = existing?.id ?? row.id;
    if (!existing) required(await supabase.from("categories").upsert({ ...row, id }, { onConflict: "id" }));
    cats.set(String(sourceRow.id), String(id));
    return;
  }
  if (table === "wallets") {
    const { data, error } = await supabase.from("wallets").select("id,name,is_default").eq("user_id", userId);
    if (error) throw new Error(error.message);
    const matched = sourceRow.is_default ? data.find((candidate) => candidate.is_default) : data.find((candidate) => candidate.name.toLowerCase() === String(row.name).toLowerCase());
    const id = matched?.id ?? row.id;
    if (!matched) required(await supabase.from("wallets").upsert({ ...row, id, is_default: false }, { onConflict: "id" }));
    wallets.set(String(sourceRow.id), String(id));
    return;
  }
  if (table === "attachments") {
    const extension = path.extname(String(row.original_name)).toLowerCase();
    const safeExtension = /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : "";
    row.storage_path = `${userId}/${row.message_id}/${row.id}${safeExtension}`;
    attachmentPaths.set(`${oldUserId}:${row.id}`, row.storage_path);
  }
  if (table === "transactions") row.wallet_id = row.wallet_id ? wallets.get(String(row.wallet_id)) ?? null : null;
  if (table === "transaction_categories") row.category_id = cats.get(String(row.category_id));
  if (table === "wallet_transfers") {
    row.from_wallet_id = wallets.get(String(row.from_wallet_id));
    row.to_wallet_id = wallets.get(String(row.to_wallet_id));
  }
  if (table === "wallet_adjustments") row.wallet_id = wallets.get(String(row.wallet_id));
  if (table === "recurrence_rules" || table === "merchant_rules") {
    const ids = Array.isArray(row.category_ids_json) ? row.category_ids_json : [];
    row.category_ids_json = ids.map((id: string) => cats.get(String(id))).filter(Boolean);
  }
  if (table === "transaction_categories" && !row.category_id) return;
  if ((table === "transactions" && sourceRow.wallet_id && !row.wallet_id) || (table === "wallet_adjustments" && !row.wallet_id) || (table === "wallet_transfers" && (!row.from_wallet_id || !row.to_wallet_id))) {
    throw new Error(`Carteira ausente na restauração de ${table}.`);
  }
  const conflict = table === "transaction_categories" ? "transaction_id,category_id" : table === "merchant_rules" ? "user_id,merchant_key" : "id";
  required(await supabase.from(table).upsert(row, { onConflict: conflict }));
}

async function main() {
  const temporary = await decryptBackup();
  let sawMeta = false;
  let sawComplete = false;
  try {
    const lines = createInterface({ input: createReadStream(temporary, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      const record = JSON.parse(line) as AnyRow;
      if (record.kind === "meta") {
        if (record.format !== "arcadya-encrypted-backup-v1") throw new Error("Versão do backup não é suportada.");
        sawMeta = true;
      } else if (record.kind === "user") {
        if (!record.email) throw new Error("Backup contém usuário sem e-mail; restauração interrompida.");
        await destinationUser(String(record.id), String(record.email), record.phone ?? null, Boolean(record.emailConfirmed), Boolean(record.phoneConfirmed), record.userMetadata ?? {});
      } else if (record.kind === "row") {
        await restoreRow(String(record.table), record.row);
      } else if (record.kind === "file") {
        const newUserId = userIds.get(String(record.userId));
        const storagePath = attachmentPaths.get(`${record.userId}:${record.attachmentId}`);
        if (!newUserId || !storagePath) throw new Error(`Metadados do anexo ${String(record.attachmentId)} não foram restaurados.`);
        const bytes = Buffer.from(String(record.contentBase64), "base64");
        const { error } = await supabase.storage.from("finance-attachments").upload(storagePath, bytes, { contentType: String(record.mimeType), cacheControl: "0", upsert: true });
        if (error) throw new Error(`Falha ao restaurar um anexo (${String(record.attachmentId)}): ${error.message}`);
      } else if (record.kind === "complete") sawComplete = true;
    }
    if (!sawMeta || !sawComplete) throw new Error("O backup não tem um marcador de conclusão válido.");
    process.stdout.write(`Restauração concluída. Contas criadas sem senha reutilizável: ${createdUsersNeedingReset}. Essas pessoas devem usar “Esqueci minha senha” para definir uma nova senha.\n`);
  } finally {
    await rm(temporary, { force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`Restauração interrompida: ${error instanceof Error ? error.message : "falha inesperada"}\n`);
  process.exitCode = 1;
});
