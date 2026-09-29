import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  chartJson: text("chart_json"),
});

export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(),
  messageId: text("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
  diskPath: text("disk_path").notNull(),
  extractedText: text("extracted_text"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [index("attachments_message_idx").on(table.messageId), uniqueIndex("attachments_hash_idx").on(table.sha256)]);

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [uniqueIndex("categories_name_idx").on(table.name)]);

export const wallets = sqliteTable("wallets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["checking", "savings", "investment"] }).notNull(),
  openingBalanceCents: integer("opening_balance_cents").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [index("wallets_kind_idx").on(table.kind)]);

export const walletTransfers = sqliteTable("wallet_transfers", {
  id: text("id").primaryKey(),
  fromWalletId: text("from_wallet_id").notNull().references(() => wallets.id, { onDelete: "restrict" }),
  toWalletId: text("to_wallet_id").notNull().references(() => wallets.id, { onDelete: "restrict" }),
  amountCents: integer("amount_cents").notNull(),
  description: text("description").notNull(),
  occurredOn: text("occurred_on").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [index("wallet_transfers_from_idx").on(table.fromWalletId), index("wallet_transfers_to_idx").on(table.toWalletId)]);

export const walletAdjustments = sqliteTable("wallet_adjustments", {
  id: text("id").primaryKey(),
  walletId: text("wallet_id").notNull().references(() => wallets.id, { onDelete: "cascade" }),
  direction: text("direction", { enum: ["credit", "debit"] }).notNull(),
  amountCents: integer("amount_cents").notNull(),
  description: text("description").notNull(),
  occurredOn: text("occurred_on").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [index("wallet_adjustments_wallet_idx").on(table.walletId)]);

export const transactions = sqliteTable("transactions", {
  id: text("id").primaryKey(),
  direction: text("direction", { enum: ["income", "expense"] }).notNull(),
  amountCents: integer("amount_cents").notNull(),
  description: text("description").notNull(),
  merchant: text("merchant"),
  occurredOn: text("occurred_on").notNull(),
  walletId: text("wallet_id").references(() => wallets.id, { onDelete: "set null" }),
  sourceMessageId: text("source_message_id").references(() => messages.id, { onDelete: "set null" }),
  recurrenceId: text("recurrence_id"),
  recurrenceDueOn: text("recurrence_due_on"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [index("transactions_occurred_idx").on(table.occurredOn), index("transactions_source_idx").on(table.sourceMessageId), uniqueIndex("transactions_recurrence_due_idx").on(table.recurrenceId, table.recurrenceDueOn)]);

export const transactionCategories = sqliteTable("transaction_categories", {
  transactionId: text("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
  categoryId: text("category_id").notNull().references(() => categories.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.transactionId, table.categoryId] })]);

export const recurrenceRules = sqliteTable("recurrence_rules", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  direction: text("direction", { enum: ["income", "expense"] }).notNull(),
  amountCents: integer("amount_cents").notNull(),
  merchant: text("merchant"),
  description: text("description").notNull(),
  frequency: text("frequency", { enum: ["weekly", "monthly", "yearly"] }).notNull(),
  startOn: text("start_on").notNull(),
  endOn: text("end_on"),
  categoryIdsJson: text("category_ids_json").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const merchantRules = sqliteTable("merchant_rules", {
  id: text("id").primaryKey(),
  merchantKey: text("merchant_key").notNull(),
  categoryIdsJson: text("category_ids_json").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [uniqueIndex("merchant_rules_key_idx").on(table.merchantKey)]);

export const processingJobs = sqliteTable("processing_jobs", {
  id: text("id").primaryKey(),
  userMessageId: text("user_message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["queued", "processing", "done", "failed"] }).notNull(),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
