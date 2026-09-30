import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.MIGRATION_EMAIL?.trim().toLowerCase();
if (!url || !serviceKey || !email) throw new Error("Defina NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e MIGRATION_EMAIL no ambiente.");

const dataDir = path.resolve(process.env.APP_DATA_DIR ?? ".data");
const sqlitePath = path.join(dataDir, "apple.sqlite");
const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
const supabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
type Row = Record<string, any>;
const all = (table: string) => sqlite.prepare(`SELECT * FROM ${table}`).all() as Row[];
const iso = (value: unknown) => new Date(Number(value)).toISOString();
const json = (value: unknown, fallback: unknown = []) => { try { return JSON.parse(String(value)); } catch { return fallback; } };
const throwOnError = <T>(result: { data: T | null; error: { message: string } | null }) => {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
};

async function migrate() {
  const { data: userData, error: userError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (userError) throw new Error(`Não consegui consultar contas no Supabase: ${userError.message}`);
  const user = userData.users.find((candidate) => candidate.email?.toLowerCase() === email);
  if (!user) throw new Error(`Não encontrei a conta Supabase para ${email}. Crie a conta e confirme o e-mail antes de migrar.`);
  const userId = user.id;

  const localCategories = all("categories");
  const categoryResult = throwOnError(await supabase.from("categories").select("id,name").eq("user_id", userId));
  const categoryByName = new Map(categoryResult.map((row) => [String(row.name).toLowerCase(), String(row.id)]));
  const categoryIds = new Map<string, string>();
  for (const row of localCategories) {
    let id = categoryByName.get(String(row.name).toLowerCase());
    if (!id) {
      id = String(row.id);
      throwOnError(await supabase.from("categories").upsert({ id, user_id: userId, name: row.name, created_at: iso(row.created_at) }, { onConflict: "id" }));
      categoryByName.set(String(row.name).toLowerCase(), id);
    }
    categoryIds.set(String(row.id), id);
  }

  const localWallets = all("wallets");
  const existingWallets = throwOnError(await supabase.from("wallets").select("id,name,kind,is_default").eq("user_id", userId));
  const walletByName = new Map(existingWallets.map((row) => [String(row.name).toLowerCase(), String(row.id)]));
  const defaultWalletId = existingWallets.find((wallet) => wallet.is_default)?.id as string | undefined;
  const walletIds = new Map<string, string>();
  for (const row of localWallets) {
    let id = String(row.id) === "wallet-checking-default" && defaultWalletId ? defaultWalletId : walletByName.get(String(row.name).toLowerCase());
    if (!id) {
      id = String(row.id);
      throwOnError(await supabase.from("wallets").upsert({
        id, user_id: userId, name: row.name, kind: row.kind, opening_balance_cents: row.opening_balance_cents,
        is_default: false, created_at: iso(row.created_at),
      }, { onConflict: "id" }));
      walletByName.set(String(row.name).toLowerCase(), id);
    }
    walletIds.set(String(row.id), id);
  }

  for (const row of all("messages")) {
    throwOnError(await supabase.from("messages").upsert({
      id: row.id, user_id: userId, role: row.role, content: row.content,
      created_at: iso(row.created_at), chart_json: row.chart_json ? json(row.chart_json, null) : null,
    }, { onConflict: "id" }));
  }

  const storage = supabase.storage.from("finance-attachments");
  for (const row of all("attachments")) {
    const diskPath = path.resolve(String(row.disk_path));
    const bytes = await fs.readFile(diskPath);
    if (bytes.length !== Number(row.size)) throw new Error(`Tamanho diferente para o anexo ${row.original_name}; parei a migração sem remover os dados locais.`);
    const extension = path.extname(String(row.original_name)).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 10);
    const storagePath = `${userId}/${row.message_id}/${row.id}${extension}`;
    const upload = await storage.upload(storagePath, bytes, { contentType: String(row.mime_type), cacheControl: "0", upsert: true });
    if (upload.error) throw new Error(`Não consegui enviar o anexo ${row.original_name}: ${upload.error.message}`);
    throwOnError(await supabase.from("attachments").upsert({
      id: row.id, user_id: userId, message_id: row.message_id, original_name: row.original_name,
      mime_type: row.mime_type, size: row.size, sha256: row.sha256, storage_path: storagePath,
      extracted_text: row.extracted_text ?? "", created_at: iso(row.created_at),
    }, { onConflict: "id" }));
  }

  for (const row of all("recurrence_rules")) {
    const categoryIdsForRule = (json(row.category_ids_json) as string[]).map((id) => categoryIds.get(id)).filter(Boolean);
    throwOnError(await supabase.from("recurrence_rules").upsert({
      id: row.id, user_id: userId, name: row.name, direction: row.direction, amount_cents: row.amount_cents,
      merchant: row.merchant, description: row.description, frequency: row.frequency, start_on: row.start_on,
      end_on: row.end_on, category_ids_json: categoryIdsForRule, active: Boolean(row.active), created_at: iso(row.created_at),
    }, { onConflict: "id" }));
  }

  for (const row of all("transactions")) {
    throwOnError(await supabase.from("transactions").upsert({
      id: row.id, user_id: userId, direction: row.direction, amount_cents: row.amount_cents,
      description: row.description, merchant: row.merchant, occurred_on: row.occurred_on,
      wallet_id: row.wallet_id ? walletIds.get(String(row.wallet_id)) ?? null : null,
      source_message_id: row.source_message_id, recurrence_id: row.recurrence_id,
      recurrence_due_on: row.recurrence_due_on, created_at: iso(row.created_at),
    }, { onConflict: "id" }));
  }

  const links = all("transaction_categories").flatMap((row) => {
    const categoryId = categoryIds.get(String(row.category_id));
    return categoryId ? [{ user_id: userId, transaction_id: row.transaction_id, category_id: categoryId }] : [];
  });
  for (const row of links) throwOnError(await supabase.from("transaction_categories").upsert(row, { onConflict: "transaction_id,category_id" }));

  for (const row of all("wallet_transfers")) {
    const fromId = walletIds.get(String(row.from_wallet_id)); const toId = walletIds.get(String(row.to_wallet_id));
    if (!fromId || !toId) throw new Error(`Carteira de transferência não encontrada para ${row.id}.`);
    throwOnError(await supabase.from("wallet_transfers").upsert({ id: row.id, user_id: userId, from_wallet_id: fromId, to_wallet_id: toId, amount_cents: row.amount_cents, description: row.description, occurred_on: row.occurred_on, created_at: iso(row.created_at) }, { onConflict: "id" }));
  }

  for (const row of all("wallet_adjustments")) {
    const walletId = walletIds.get(String(row.wallet_id));
    if (!walletId) throw new Error(`Carteira de ajuste não encontrada para ${row.id}.`);
    throwOnError(await supabase.from("wallet_adjustments").upsert({ id: row.id, user_id: userId, wallet_id: walletId, direction: row.direction, amount_cents: row.amount_cents, description: row.description, occurred_on: row.occurred_on, created_at: iso(row.created_at) }, { onConflict: "id" }));
  }

  for (const row of all("merchant_rules")) {
    const categoryIdsForRule = (json(row.category_ids_json) as string[]).map((id) => categoryIds.get(id)).filter(Boolean);
    throwOnError(await supabase.from("merchant_rules").upsert({
      id: row.id, user_id: userId, merchant_key: row.merchant_key, category_ids_json: categoryIdsForRule,
      updated_at: iso(row.updated_at),
    }, { onConflict: "user_id,merchant_key" }));
  }

  for (const row of all("processing_jobs")) {
    const status = row.status === "processing" ? "failed" : row.status;
    throwOnError(await supabase.from("processing_jobs").upsert({
      id: row.id, user_id: userId, user_message_id: row.user_message_id, status,
      error: row.status === "processing" ? "Tarefa interrompida durante a migração." : row.error,
      created_at: iso(row.created_at), updated_at: iso(row.updated_at),
    }, { onConflict: "id" }));
  }

  const counts = Object.fromEntries(["messages", "attachments", "transactions", "wallets", "recurrence_rules"].map((table) => [table, all(table).length]));
  process.stdout.write(`Migração concluída para ${email}. Registros locais preservados: ${JSON.stringify(counts)}\n`);
}

migrate().catch((error) => {
  process.stderr.write(`Migração interrompida; o SQLite local não foi alterado: ${error instanceof Error ? error.message : "falha inesperada"}\n`);
  process.exitCode = 1;
}).finally(() => sqlite.close());
