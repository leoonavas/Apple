import "server-only";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const dataDir = path.resolve(/*turbopackIgnore: true*/ process.env.APP_DATA_DIR ?? ".data");
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
export const attachmentsDir = path.join(dataDir, "attachments");
fs.mkdirSync(attachmentsDir, { recursive: true, mode: 0o700 });

const globalDb = globalThis as typeof globalThis & { appleSqlite?: Database.Database };
const sqlite = globalDb.appleSqlite ?? new Database(path.join(dataDir, "apple.sqlite"));
globalDb.appleSqlite = sqlite;
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");
const schemaVersion = Number(sqlite.pragma("user_version", { simple: true }));
if (schemaVersion > 3) throw new Error(`Banco Apple Finanças usa schema ${schemaVersion}, mais novo que este app.`);
if (schemaVersion < 1) sqlite.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, role TEXT NOT NULL, content TEXT NOT NULL,
    created_at INTEGER NOT NULL, chart_json TEXT
  );
  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL,
    sha256 TEXT NOT NULL UNIQUE, disk_path TEXT NOT NULL, extracted_text TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS attachments_message_idx ON attachments(message_id);
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY, direction TEXT NOT NULL CHECK(direction IN ('income','expense')),
    amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), description TEXT NOT NULL,
    merchant TEXT, occurred_on TEXT NOT NULL,
    source_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
    recurrence_id TEXT, recurrence_due_on TEXT, created_at INTEGER NOT NULL,
    UNIQUE(recurrence_id, recurrence_due_on)
  );
  CREATE INDEX IF NOT EXISTS transactions_occurred_idx ON transactions(occurred_on);
  CREATE INDEX IF NOT EXISTS transactions_source_idx ON transactions(source_message_id);
  CREATE TABLE IF NOT EXISTS transaction_categories (
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY(transaction_id, category_id)
  );
  CREATE TABLE IF NOT EXISTS recurrence_rules (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('income','expense')),
    amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), merchant TEXT,
    description TEXT NOT NULL,
    frequency TEXT NOT NULL CHECK(frequency IN ('weekly','monthly','yearly')),
    start_on TEXT NOT NULL, end_on TEXT, category_ids_json TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS merchant_rules (
    id TEXT PRIMARY KEY, merchant_key TEXT NOT NULL UNIQUE,
    category_ids_json TEXT NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS processing_jobs (
    id TEXT PRIMARY KEY, user_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('queued','processing','done','failed')),
    error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
`);
if (schemaVersion < 1) sqlite.pragma("user_version = 1");

if (schemaVersion < 2) {
  const migrateWallets = sqlite.transaction(() => {
    sqlite.exec(`
      CREATE TABLE wallets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('checking','savings','investment')),
        opening_balance_cents INTEGER NOT NULL DEFAULT 0 CHECK(opening_balance_cents >= 0),
        created_at INTEGER NOT NULL
      );
      CREATE INDEX wallets_kind_idx ON wallets(kind);
      CREATE TABLE wallet_transfers (
        id TEXT PRIMARY KEY,
        from_wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
        to_wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
        amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
        description TEXT NOT NULL,
        occurred_on TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        CHECK(from_wallet_id <> to_wallet_id)
      );
      CREATE INDEX wallet_transfers_from_idx ON wallet_transfers(from_wallet_id);
      CREATE INDEX wallet_transfers_to_idx ON wallet_transfers(to_wallet_id);
      ALTER TABLE transactions ADD COLUMN wallet_id TEXT REFERENCES wallets(id) ON DELETE SET NULL;
      CREATE INDEX transactions_wallet_idx ON transactions(wallet_id);
      INSERT INTO wallets(id, name, kind, opening_balance_cents, created_at)
        VALUES ('wallet-checking-default', 'Conta corrente', 'checking', 0, ${Date.now()});
      UPDATE transactions SET wallet_id = 'wallet-checking-default' WHERE wallet_id IS NULL;
      PRAGMA user_version = 2;
    `);
  });
  migrateWallets();
}

if (schemaVersion < 3) {
  const migrateWalletAdjustments = sqlite.transaction(() => {
    sqlite.exec(`
      CREATE TABLE wallet_adjustments (
        id TEXT PRIMARY KEY,
        wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
        direction TEXT NOT NULL CHECK(direction IN ('credit','debit')),
        amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
        description TEXT NOT NULL,
        occurred_on TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX wallet_adjustments_wallet_idx ON wallet_adjustments(wallet_id);
      PRAGMA user_version = 3;
    `);
  });
  migrateWalletAdjustments();
}

export const db = drizzle(sqlite, { schema });
export const rawDb = sqlite;

const defaultCategories = [
  "Alimentação", "Moradia", "Transporte", "Saúde", "Educação", "Lazer",
  "Compras Online", "Vestuário", "Assinaturas", "Salário", "Contas", "Outros",
];
const insertCategory = sqlite.prepare("INSERT OR IGNORE INTO categories(id, name, created_at) VALUES (?, ?, ?)");
for (const name of defaultCategories) {
  const slug = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  insertCategory.run(`cat-${slug}`, name, Date.now());
}

export function closeDatabaseForTests() {
  sqlite.close();
}
