import "server-only";
import { randomUUID } from "node:crypto";
import { asc } from "drizzle-orm";
import { db, rawDb } from "@/lib/db";
import { categories as categoriesTable, messages as messagesTable } from "@/lib/db/schema";
import { localDate, periodFor, clampMonthlyDay } from "./dates";
import { MAX_TRANSACTION_AMOUNT_CENTS, moneyMarkdown, normalizeMerchant } from "./money";
import type { ChartSpec, Direction, MessageView, TransactionView } from "./types";

const DEFAULT_CHECKING_WALLET_ID = "wallet-checking-default";
export type WalletKind = "checking" | "savings" | "investment";
export type WalletView = {
  id: string;
  name: string;
  kind: WalletKind;
  openingBalanceCents: number;
  balanceCents: number;
  isDefault: boolean;
};
const WALLET_BALANCE_SQL = `w.opening_balance_cents
  + COALESCE((SELECT SUM(CASE WHEN t.direction='income' THEN t.amount_cents ELSE -t.amount_cents END) FROM transactions t WHERE t.wallet_id=w.id), 0)
  + COALESCE((SELECT SUM(wt.amount_cents) FROM wallet_transfers wt WHERE wt.to_wallet_id=w.id), 0)
  - COALESCE((SELECT SUM(wt.amount_cents) FROM wallet_transfers wt WHERE wt.from_wallet_id=w.id), 0)
  + COALESCE((SELECT SUM(CASE WHEN wa.direction='credit' THEN wa.amount_cents ELSE -wa.amount_cents END) FROM wallet_adjustments wa WHERE wa.wallet_id=w.id), 0)`;

export type Category = { id: string; name: string };
export type ReportResult = {
  periodLabel: string;
  expenseCents: number;
  incomeCents: number;
  netCents: number;
  count: number;
  categoryRows: Array<{ name: string; cents: number; count: number }>;
  merchantRows: Array<{ name: string; cents: number; count: number }>;
  chart: ChartSpec | null;
};

export function getCategories(): Category[] {
  return db.select({ id: categoriesTable.id, name: categoriesTable.name }).from(categoriesTable).orderBy(asc(categoriesTable.name)).all();
}

export function listMessages(): MessageView[] {
  generateDueRecurrences();
  const rows = rawDb.prepare("SELECT id, role, content, created_at AS createdAt, chart_json AS chartJson FROM messages WHERE role IN ('user','assistant') ORDER BY created_at DESC LIMIT 100").all() as Array<Record<string, unknown>>;
  return rows.reverse().map((row) => {
    const attachments = rawDb.prepare("SELECT id, original_name AS originalName, mime_type AS mimeType, size, CASE WHEN mime_type LIKE 'audio/%' THEN NULLIF(TRIM(extracted_text), '') ELSE NULL END AS transcript FROM attachments WHERE message_id = ? ORDER BY created_at").all(row.id) as MessageView["attachments"];
    return { id: String(row.id), role: row.role as MessageView["role"], content: String(row.content), createdAt: Number(row.createdAt), chart: row.chartJson ? JSON.parse(String(row.chartJson)) as ChartSpec : null, attachments };
  });
}

export function getRecentContext(excludeMessageId: string): string {
  const rows = rawDb.prepare("SELECT role, content FROM messages WHERE id <> ? AND role IN ('user','assistant') ORDER BY created_at DESC LIMIT 6").all(excludeMessageId) as Array<{ role: string; content: string }>;
  return rows.reverse().map((row) => `${row.role}: ${row.content.slice(0, 400)}`).join("\n");
}

export function addMessage(role: "user" | "assistant", content: string, chart: ChartSpec | null = null, id = randomUUID()) {
  db.insert(messagesTable).values({ id, role, content, createdAt: new Date(), chartJson: chart ? JSON.stringify(chart) : null }).run();
  return id;
}

export function updateMessageContent(id: string, content: string, chart: ChartSpec | null = null) {
  rawDb.prepare("UPDATE messages SET content = ?, chart_json = ? WHERE id = ?").run(content, chart ? JSON.stringify(chart) : null, id);
}

export function getMerchantRule(merchant: string | null): string[] | null {
  if (!merchant) return null;
  const row = rawDb.prepare("SELECT category_ids_json AS ids FROM merchant_rules WHERE merchant_key = ?").get(normalizeMerchant(merchant)) as { ids: string } | undefined;
  return row ? JSON.parse(row.ids) as string[] : null;
}

export function resolveCategoryIds(names: string[], merchant: string | null, sourceText: string): string[] {
  const all = getCategories();
  const normalizedText = sourceText.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const explicit = all.filter((category) => normalizedText.includes(category.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase())).map((category) => category.id);
  if (explicit.length) return [...new Set(explicit)];
  const learned = getMerchantRule(merchant);
  if (learned?.length) return learned;
  const resolved = names.map((name) => all.find((category) => category.name.toLowerCase() === name.toLowerCase())?.id).filter((id): id is string => Boolean(id));
  if (resolved.length) return [...new Set(resolved)];
  return [all.find((category) => category.name === "Outros")?.id ?? "cat-outros"];
}

export function saveAttachment(input: { id: string; messageId: string; originalName: string; mimeType: string; size: number; sha256: string; diskPath: string; extractedText: string }) {
  rawDb.prepare(`INSERT INTO attachments(id, message_id, original_name, mime_type, size, sha256, disk_path, extracted_text, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(input.id, input.messageId, input.originalName, input.mimeType, input.size, input.sha256, input.diskPath, input.extractedText, Date.now());
}

export function sourceAttachments(messageId: string) {
  return rawDb.prepare("SELECT id, original_name AS originalName, mime_type AS mimeType, size, disk_path AS diskPath, extracted_text AS extractedText FROM attachments WHERE message_id = ? ORDER BY created_at").all(messageId) as Array<{ id: string; originalName: string; mimeType: string; size: number; diskPath: string; extractedText: string | null }>;
}

export function updateAttachmentText(id: string, text: string) {
  rawDb.prepare("UPDATE attachments SET extracted_text=? WHERE id=?").run(text, id);
}

export function listWallets(): WalletView[] {
  generateDueRecurrences();
  const rows = rawDb.prepare(`SELECT w.id, w.name, w.kind, w.opening_balance_cents AS openingBalanceCents,
      ${WALLET_BALANCE_SQL} AS balanceCents
    FROM wallets w
    ORDER BY CASE w.kind WHEN 'checking' THEN 0 WHEN 'savings' THEN 1 ELSE 2 END, w.created_at, w.name`).all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id), name: String(row.name), kind: row.kind as WalletKind,
    openingBalanceCents: Number(row.openingBalanceCents), balanceCents: Number(row.balanceCents),
    isDefault: String(row.id) === DEFAULT_CHECKING_WALLET_ID,
  }));
}

export function createWallet(input: { name: string; kind: WalletKind; openingBalanceCents: number }) {
  assertWalletAmount(input.openingBalanceCents, true);
  const id = randomUUID();
  rawDb.prepare("INSERT INTO wallets(id, name, kind, opening_balance_cents, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, input.name.trim(), input.kind, input.openingBalanceCents, Date.now());
  return id;
}

export function updateWallet(input: { id: string; name: string; openingBalanceCents: number }) {
  assertWalletAmount(input.openingBalanceCents, true);
  const result = rawDb.prepare("UPDATE wallets SET name = ?, opening_balance_cents = ? WHERE id = ?")
    .run(input.name.trim(), input.openingBalanceCents, input.id);
  if (!result.changes) throw new Error("Carteira não encontrada.");
}

export function transferWalletFunds(input: { fromWalletId: string; toWalletId: string | null; createDestination?: { name: string; kind: WalletKind }; amountCents: number; description: string }) {
  assertWalletAmount(input.amountCents, false);
  if (input.toWalletId && input.fromWalletId === input.toWalletId) throw new Error("Escolha carteiras diferentes para transferir.");
  const id = randomUUID();
  const transfer = rawDb.transaction(() => {
    const balanceFor = rawDb.prepare(`SELECT ${WALLET_BALANCE_SQL} AS balanceCents FROM wallets w WHERE w.id = ?`);
    const source = balanceFor.get(input.fromWalletId) as { balanceCents: number } | undefined;
    if (!source) throw new Error("Não encontrei a carteira de origem.");
    if (Number(source.balanceCents) < input.amountCents) throw new Error("O saldo disponível nessa carteira não cobre a transferência.");
    let toWalletId = input.toWalletId;
    if (!toWalletId && input.createDestination) {
      toWalletId = randomUUID();
      rawDb.prepare("INSERT INTO wallets(id, name, kind, opening_balance_cents, created_at) VALUES (?, ?, ?, 0, ?)")
        .run(toWalletId, input.createDestination.name.trim(), input.createDestination.kind, Date.now());
    }
    if (!toWalletId) throw new Error("Escolha uma carteira de destino.");
    if (input.fromWalletId === toWalletId) throw new Error("Escolha carteiras diferentes para transferir.");
    if (!balanceFor.get(toWalletId)) throw new Error("Não encontrei a carteira de destino.");
    rawDb.prepare(`INSERT INTO wallet_transfers(id, from_wallet_id, to_wallet_id, amount_cents, description, occurred_on, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.fromWalletId, toWalletId, input.amountCents, input.description.trim() || "Transferência entre carteiras", localDate(), Date.now());
    return toWalletId;
  });
  return { id, toWalletId: transfer() };
}

export function adjustWalletBalance(input: { walletId: string; direction: "credit" | "debit"; amountCents: number; description: string }) {
  assertWalletAmount(input.amountCents, false);
  const id = randomUUID();
  const adjust = rawDb.transaction(() => {
    const balance = rawDb.prepare(`SELECT ${WALLET_BALANCE_SQL} AS balanceCents FROM wallets w WHERE w.id = ?`).get(input.walletId) as { balanceCents: number } | undefined;
    if (!balance) throw new Error("Carteira não encontrada.");
    if (input.direction === "debit" && Number(balance.balanceCents) < input.amountCents) throw new Error("O saldo da carteira não cobre esse valor.");
    rawDb.prepare(`INSERT INTO wallet_adjustments(id, wallet_id, direction, amount_cents, description, occurred_on, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.walletId, input.direction, input.amountCents, input.description.trim(), localDate(), Date.now());
  });
  adjust();
  return id;
}

export function setWalletBalance(input: { walletId: string; balanceCents: number; description: string }) {
  assertWalletAmount(input.balanceCents, true);
  const id = randomUUID();
  const setBalance = rawDb.transaction(() => {
    const current = rawDb.prepare(`SELECT ${WALLET_BALANCE_SQL} AS balanceCents FROM wallets w WHERE w.id = ?`).get(input.walletId) as { balanceCents: number } | undefined;
    if (!current) throw new Error("Carteira não encontrada.");
    const delta = input.balanceCents - Number(current.balanceCents);
    if (!delta) return 0;
    rawDb.prepare(`INSERT INTO wallet_adjustments(id, wallet_id, direction, amount_cents, description, occurred_on, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.walletId, delta > 0 ? "credit" : "debit", Math.abs(delta), input.description.trim(), localDate(), Date.now());
    return delta;
  });
  return setBalance();
}

export function createTransaction(input: { direction: Direction; amountCents: number; description: string; merchant: string | null; occurredOn: string; sourceMessageId: string | null; categoryIds: string[]; walletId?: string }) {
  assertTransactionAmount(input.amountCents);
  const walletId = input.walletId ?? DEFAULT_CHECKING_WALLET_ID;
  if (!rawDb.prepare("SELECT 1 FROM wallets WHERE id = ?").get(walletId)) throw new Error("Conta de destino não encontrada.");
  const id = randomUUID();
  const insert = rawDb.transaction(() => {
    rawDb.prepare(`INSERT INTO transactions(id, direction, amount_cents, description, merchant, occurred_on, wallet_id, source_message_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.direction, input.amountCents, input.description, input.merchant, input.occurredOn, walletId, input.sourceMessageId, Date.now());
    const addCategory = rawDb.prepare("INSERT OR IGNORE INTO transaction_categories(transaction_id, category_id) VALUES (?, ?)");
    for (const categoryId of input.categoryIds) addCategory.run(id, categoryId);
  });
  insert();
  return id;
}

export function updateTransaction(input: { id: string; direction: Direction; amountCents: number; description: string; merchant: string | null; occurredOn: string; categoryIds: string[] }) {
  assertTransactionAmount(input.amountCents);
  const update = rawDb.transaction(() => {
    const result = rawDb.prepare("UPDATE transactions SET direction = ?, amount_cents = ?, description = ?, merchant = ?, occurred_on = ? WHERE id = ?")
      .run(input.direction, input.amountCents, input.description, input.merchant, input.occurredOn, input.id);
    if (!result.changes) throw new Error("Movimentação não encontrada.");
    rawDb.prepare("DELETE FROM transaction_categories WHERE transaction_id = ?").run(input.id);
    const addCategory = rawDb.prepare("INSERT OR IGNORE INTO transaction_categories(transaction_id, category_id) VALUES (?, ?)");
    for (const categoryId of input.categoryIds) addCategory.run(input.id, categoryId);
    if (input.merchant && input.categoryIds.length) {
      const key = normalizeMerchant(input.merchant);
      rawDb.prepare(`INSERT INTO merchant_rules(id, merchant_key, category_ids_json, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(merchant_key) DO UPDATE SET category_ids_json = excluded.category_ids_json, updated_at = excluded.updated_at`)
        .run(randomUUID(), key, JSON.stringify(input.categoryIds), Date.now());
    }
  });
  update();
}

export function deleteTransaction(id: string) {
  const result = rawDb.prepare("DELETE FROM transactions WHERE id = ?").run(id);
  return result.changes > 0;
}

export function listTransactions(limit = 200): TransactionView[] {
  generateDueRecurrences();
  const rows = rawDb.prepare(`SELECT t.id, t.direction, t.amount_cents AS amountCents, t.description, t.merchant,
      t.occurred_on AS occurredOn, group_concat(c.name, '|||') AS categories
    FROM transactions t LEFT JOIN transaction_categories tc ON tc.transaction_id = t.id
    LEFT JOIN categories c ON c.id = tc.category_id
    GROUP BY t.id ORDER BY t.occurred_on DESC, t.created_at DESC LIMIT ?`).all(limit) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id), direction: row.direction as Direction, amountCents: Number(row.amountCents),
    description: String(row.description), merchant: row.merchant ? String(row.merchant) : null,
    occurredOn: String(row.occurredOn), categories: row.categories ? String(row.categories).split("|||") : [],
  }));
}

export function report(options: { period: "today" | "week" | "month" | "all" | "custom"; start?: string | null; end?: string | null; categoryNames?: string[]; groupBy?: "day" | "week" | "month" | "category" | null }): ReportResult {
  generateDueRecurrences();
  const period = periodFor(options.period, options.start, options.end);
  const categoryNames = options.categoryNames ?? [];
  const categoryIds = categoryNames.map((name) => getCategories().find((c) => c.name.toLowerCase() === name.toLowerCase())?.id).filter((id): id is string => Boolean(id));
  let categoryWhere = "";
  const params: Array<string> = [period.start, period.end];
  if (categoryIds.length) {
    categoryWhere = `AND EXISTS (SELECT 1 FROM transaction_categories filter_tc WHERE filter_tc.transaction_id = t.id AND filter_tc.category_id IN (${categoryIds.map(() => "?").join(",")}))`;
    params.push(...categoryIds);
  }
  const totals = rawDb.prepare(`SELECT
      COALESCE(SUM(CASE WHEN t.direction='expense' THEN t.amount_cents ELSE 0 END), 0) AS expense,
      COALESCE(SUM(CASE WHEN t.direction='income' THEN t.amount_cents ELSE 0 END), 0) AS income,
      COUNT(*) AS count
    FROM transactions t WHERE t.occurred_on BETWEEN ? AND ? ${categoryWhere}`).get(...params) as { expense: number; income: number; count: number };
  const categoryRows = rawDb.prepare(`SELECT c.name AS name, SUM(t.amount_cents) AS cents, COUNT(DISTINCT t.id) AS count
    FROM transactions t JOIN transaction_categories tc ON tc.transaction_id=t.id
    JOIN categories c ON c.id=tc.category_id
    WHERE t.direction='expense' AND t.occurred_on BETWEEN ? AND ? ${categoryWhere}
    GROUP BY c.id ORDER BY cents DESC`).all(...params) as Array<{ name: string; cents: number; count: number }>;
  const merchantRows = rawDb.prepare(`SELECT COALESCE(NULLIF(t.merchant,''), t.description) AS name, SUM(t.amount_cents) AS cents, COUNT(DISTINCT t.id) AS count
    FROM transactions t WHERE t.direction='expense' AND t.occurred_on BETWEEN ? AND ? ${categoryWhere}
    GROUP BY COALESCE(NULLIF(t.merchant,''), t.description) ORDER BY cents DESC LIMIT 10`).all(...params) as Array<{ name: string; cents: number; count: number }>;
  const groupBy = options.groupBy ?? (options.period === "all" ? "month" : "day");
  let chart: ChartSpec | null = null;
  if (groupBy === "category" || categoryNames.length) {
    const rows = categoryNames.length ? merchantRows : categoryRows;
    chart = { type: "bar", title: categoryNames.length ? "Gastos por estabelecimento" : "Gastos por categoria", data: rows.slice(0, 10).map((r) => ({ label: r.name, value: Number(r.cents) })) };
  } else {
    const buckets = rawDb.prepare(`SELECT substr(t.occurred_on, 1, ${groupBy === "month" ? 7 : 10}) AS label,
      SUM(CASE WHEN t.direction='income' THEN t.amount_cents ELSE 0 END) AS income,
      SUM(CASE WHEN t.direction='expense' THEN t.amount_cents ELSE 0 END) AS expense
      FROM transactions t WHERE t.occurred_on BETWEEN ? AND ? GROUP BY label ORDER BY label`).all(period.start, period.end) as Array<{ label: string; income: number; expense: number }>;
    const grouped = groupBy === "week" ? buckets.reduce((acc, row) => {
      const [year, month, day] = row.label.split("-").map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
      const key = date.toISOString().slice(0, 10);
      const bucket = acc.get(key) ?? { label: key, income: 0, expense: 0 };
      bucket.income += Number(row.income); bucket.expense += Number(row.expense); acc.set(key, bucket);
      return acc;
    }, new Map<string, { label: string; income: number; expense: number }>()) : null;
    chart = { type: "line", title: "Entradas e saídas", data: (grouped ? [...grouped.values()] : buckets).map((r) => ({ label: r.label, income: Number(r.income), expense: Number(r.expense) })) };
  }
  return { periodLabel: period.label, expenseCents: Number(totals.expense), incomeCents: Number(totals.income), netCents: Number(totals.income) - Number(totals.expense), count: Number(totals.count), categoryRows: categoryRows.map((r) => ({ ...r, cents: Number(r.cents), count: Number(r.count) })), merchantRows: merchantRows.map((r) => ({ ...r, cents: Number(r.cents), count: Number(r.count) })), chart };
}

export function createRecurrence(input: { name: string; direction: Direction; amountCents: number; merchant: string | null; description: string; frequency: "weekly" | "monthly" | "yearly"; startOn: string; endOn: string | null; categoryIds: string[] }) {
  assertTransactionAmount(input.amountCents);
  const id = randomUUID();
  rawDb.prepare(`INSERT INTO recurrence_rules(id, name, direction, amount_cents, merchant, description, frequency, start_on, end_on, category_ids_json, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
    .run(id, input.name, input.direction, input.amountCents, input.merchant, input.description, input.frequency, input.startOn, input.endOn, JSON.stringify(input.categoryIds), Date.now());
  generateDueRecurrences();
  return id;
}

export function listRecurrences() {
  generateDueRecurrences();
  return rawDb.prepare("SELECT id, name, direction, amount_cents AS amountCents, merchant, description, frequency, start_on AS startOn, end_on AS endOn, category_ids_json AS categoryIdsJson, active FROM recurrence_rules ORDER BY active DESC, created_at DESC").all() as Array<Record<string, unknown>>;
}

export function toggleRecurrence(id: string, active: boolean) {
  rawDb.prepare("UPDATE recurrence_rules SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
}

function generateDueRecurrences() {
  const today = localDate();
  const rules = rawDb.prepare("SELECT * FROM recurrence_rules WHERE active=1 AND start_on <= ? AND (end_on IS NULL OR end_on >= ?)").all(today, today) as Array<Record<string, unknown>>;
  const insert = rawDb.prepare(`INSERT OR IGNORE INTO transactions(id,direction,amount_cents,description,merchant,occurred_on,wallet_id,recurrence_id,recurrence_due_on,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const addCategory = rawDb.prepare("INSERT OR IGNORE INTO transaction_categories(transaction_id,category_id) VALUES (?,?)");
  const lastDue = rawDb.prepare("SELECT MAX(recurrence_due_on) AS last FROM transactions WHERE recurrence_id=?");
  for (const rule of rules) {
    const existing = lastDue.get(rule.id) as { last: string | null };
    const start = String(existing.last ? addDays(existing.last, 1) : rule.start_on);
    for (const due of occurrenceDates(start, today, String(rule.start_on), String(rule.frequency))) {
      if (rule.end_on && due > String(rule.end_on)) continue;
      const id = randomUUID();
      if (insert.run(id, rule.direction, rule.amount_cents, rule.description, rule.merchant, due, DEFAULT_CHECKING_WALLET_ID, rule.id, due, Date.now()).changes) {
        for (const categoryId of JSON.parse(String(rule.category_ids_json)) as string[]) addCategory.run(id, categoryId);
      }
    }
  }
}

function assertTransactionAmount(amountCents: number) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > MAX_TRANSACTION_AMOUNT_CENTS) {
    throw new Error(`O valor precisa estar entre R$ 0,01 e ${moneyMarkdown(MAX_TRANSACTION_AMOUNT_CENTS)}.`);
  }
}

function assertWalletAmount(amountCents: number, allowZero: boolean) {
  if (!Number.isSafeInteger(amountCents) || amountCents < (allowZero ? 0 : 1) || amountCents > MAX_TRANSACTION_AMOUNT_CENTS) {
    throw new Error(`O valor precisa estar entre ${allowZero ? "R$ 0,00" : "R$ 0,01"} e ${moneyMarkdown(MAX_TRANSACTION_AMOUNT_CENTS)}.`);
  }
}

function occurrenceDates(from: string, to: string, anchor: string, frequency: string): string[] {
  const result: string[] = [];
  const [ay, am, ad] = anchor.split("-").map(Number);
  let cursor = anchor;
  while (cursor < from) cursor = nextOccurrence(cursor, frequency, ay, am, ad);
  while (cursor <= to) {
    result.push(cursor);
    cursor = nextOccurrence(cursor, frequency, ay, am, ad);
  }
  return result;
}

function nextOccurrence(current: string, frequency: string, anchorYear: number, anchorMonth: number, anchorDay: number) {
  const [year, month, day] = current.split("-").map(Number);
  if (frequency === "weekly") {
    const date = new Date(Date.UTC(year, month - 1, day + 7));
    return date.toISOString().slice(0, 10);
  }
  if (frequency === "yearly") return clampMonthlyDay(year + 1, anchorMonth - 1, anchorDay);
  const nextMonth = month === 12 ? 0 : month;
  const nextYear = month === 12 ? year + 1 : year;
  return clampMonthlyDay(nextYear, nextMonth, anchorDay);
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

const recurrenceScheduler = globalThis as typeof globalThis & { appleRecurrenceTimer?: NodeJS.Timeout };
if (!recurrenceScheduler.appleRecurrenceTimer) {
  recurrenceScheduler.appleRecurrenceTimer = setInterval(() => {
    try { generateDueRecurrences(); }
    catch (error) { console.error("Falha ao materializar recorrências:", error); }
  }, 60_000);
  recurrenceScheduler.appleRecurrenceTimer.unref();
}
