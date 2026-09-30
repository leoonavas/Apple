import "server-only";
import { randomUUID } from "node:crypto";
import { withDataContext } from "@/lib/supabase/data-context";
import { localDate, periodFor, clampMonthlyDay } from "./dates";
import { MAX_TRANSACTION_AMOUNT_CENTS, moneyMarkdown, normalizeMerchant } from "./money";
import type { ChartSpec, Direction, MessageView, TransactionView } from "./types";

export type WalletKind = "checking" | "savings" | "investment";
export type WalletView = {
  id: string;
  name: string;
  kind: WalletKind;
  openingBalanceCents: number;
  balanceCents: number;
  isDefault: boolean;
};
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

type Row = Record<string, any>;
function checked<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}
function toMillis(value: string | null | undefined) { return value ? new Date(value).getTime() : Date.now(); }
function assertAmount(amountCents: number, allowZero = false) {
  if (!Number.isSafeInteger(amountCents) || amountCents < (allowZero ? 0 : 1) || amountCents > MAX_TRANSACTION_AMOUNT_CENTS) {
    throw new Error(`O valor precisa estar entre ${allowZero ? "R$ 0,00" : "R$ 0,01"} e ${moneyMarkdown(MAX_TRANSACTION_AMOUNT_CENTS)}.`);
  }
}
function chartDate(value: string, groupBy: "day" | "week" | "month") {
  if (groupBy === "month") return value.slice(0, 7);
  if (groupBy === "day") return value.slice(0, 10);
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

export async function getCategories(): Promise<Category[]> {
  return withDataContext(async ({ client, userId }) => checked(await client.from("categories").select("id,name").eq("user_id", userId).order("name")));
}

export async function createCategory(name: string) {
  return withDataContext(async ({ client, userId }) => {
    const id = `cat-${randomUUID()}`;
    const { error } = await client.from("categories").insert({ id, user_id: userId, name: name.trim() });
    if (error) {
      if (error.code === "23505") throw new Error("Essa categoria já existe.");
      throw new Error(error.message);
    }
    return id;
  });
}

export async function listMessages(): Promise<MessageView[]> {
  return withDataContext(async ({ client, userId }) => {
    await generateDueRecurrences();
    const messages = checked(await client.from("messages").select("id,role,content,created_at,chart_json")
      .eq("user_id", userId).in("role", ["user", "assistant"]).order("created_at", { ascending: false }).order("id", { ascending: false }).range(0, 99)) as Row[];
    const ids = messages.map((row) => row.id as string);
    const attachments = ids.length ? checked(await client.from("attachments")
      .select("id,message_id,original_name,mime_type,size,extracted_text,created_at")
      .eq("user_id", userId).in("message_id", ids).order("created_at")) as Row[] : [];
    const byMessage = new Map<string, MessageView["attachments"]>();
    for (const file of attachments) {
      const rows = byMessage.get(file.message_id) ?? [];
      rows.push({
        id: file.id, originalName: file.original_name, mimeType: file.mime_type, size: Number(file.size),
        transcript: String(file.mime_type).startsWith("audio/") ? (String(file.extracted_text ?? "").trim() || null) : null,
      });
      byMessage.set(file.message_id, rows);
    }
    return messages.reverse().map((row) => ({
      id: row.id, role: row.role, content: row.content, createdAt: toMillis(row.created_at),
      chart: row.chart_json as ChartSpec | null, attachments: byMessage.get(row.id) ?? [],
    })) as MessageView[];
  });
}

export async function getRecentContext(excludeMessageId: string): Promise<string> {
  return withDataContext(async ({ client, userId }) => {
    const rows = checked(await client.from("messages").select("role,content").eq("user_id", userId)
      .neq("id", excludeMessageId).in("role", ["user", "assistant"]).order("created_at", { ascending: false }).limit(6)) as Row[];
    return rows.reverse().map((row) => `${row.role}: ${String(row.content).slice(0, 400)}`).join("\n");
  });
}

export async function addMessage(role: "user" | "assistant", content: string, chart: ChartSpec | null = null, id = randomUUID()) {
  return withDataContext(async ({ client, userId }) => {
    checked(await client.from("messages").insert({ id, user_id: userId, role, content, chart_json: chart }));
    return id;
  });
}

export async function deleteMessage(id: string) {
  return withDataContext(async ({ client, userId }) => {
    const { data, error } = await client.from("messages").delete().eq("user_id", userId).eq("id", id).select("id");
    if (error) throw new Error(error.message);
    return Boolean(data?.length);
  });
}

export async function updateMessageContent(id: string, content: string, chart: ChartSpec | null = null) {
  return withDataContext(async ({ client, userId }) => checked(await client.from("messages").update({ content, chart_json: chart })
    .eq("user_id", userId).eq("id", id)));
}

export async function getMerchantRule(merchant: string | null): Promise<string[] | null> {
  if (!merchant) return null;
  return withDataContext(async ({ client, userId }) => {
    const { data, error } = await client.from("merchant_rules").select("category_ids_json").eq("user_id", userId)
      .eq("merchant_key", normalizeMerchant(merchant)).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? data.category_ids_json as string[] : null;
  });
}

export async function resolveCategoryIds(names: string[], merchant: string | null, sourceText: string): Promise<string[]> {
  const all = await getCategories();
  const normalizedText = sourceText.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const explicit = all.filter((category) => normalizedText.includes(category.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase())).map((category) => category.id);
  if (explicit.length) return [...new Set(explicit)];
  const learned = await getMerchantRule(merchant);
  if (learned?.length) return learned;
  const resolved = names.map((name) => all.find((category) => category.name.toLowerCase() === name.toLowerCase())?.id).filter((id): id is string => Boolean(id));
  return resolved.length ? [...new Set(resolved)] : [all.find((category) => category.name === "Outros")?.id ?? ""].filter(Boolean);
}

export async function saveAttachment(input: { id: string; messageId: string; originalName: string; mimeType: string; size: number; sha256: string; storagePath: string; extractedText?: string }) {
  return withDataContext(async ({ client, userId }) => checked(await client.from("attachments").insert({
    id: input.id, user_id: userId, message_id: input.messageId, original_name: input.originalName, mime_type: input.mimeType,
    size: input.size, sha256: input.sha256, storage_path: input.storagePath, extracted_text: input.extractedText ?? "",
  })));
}

export async function getAttachment(id: string) {
  return withDataContext(async ({ client, userId }) => {
    const { data, error } = await client.from("attachments").select("id,original_name,mime_type,size,storage_path,message_id")
      .eq("user_id", userId).eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { id: data.id, originalName: data.original_name, mimeType: data.mime_type, size: Number(data.size), storagePath: data.storage_path, messageId: data.message_id } : null;
  });
}

export async function findAttachmentByHashes(hashes: string[]) {
  if (!hashes.length) return null;
  return withDataContext(async ({ client, userId }) => {
    const { data, error } = await client.from("attachments").select("id,sha256,original_name").eq("user_id", userId).in("sha256", hashes).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });
}

export async function getAttachmentUsage() {
  return withDataContext(async ({ client, userId }) => {
    const { data, error } = await client.from("attachments").select("size,created_at").eq("user_id", userId);
    if (error) throw new Error(error.message);
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    return (data ?? []).reduce((totals, file) => {
      totals.stored += Number(file.size);
      if (new Date(file.created_at) >= monthStart) totals.processedThisMonth += Number(file.size);
      return totals;
    }, { stored: 0, processedThisMonth: 0 });
  });
}

export async function sourceAttachments(messageId: string) {
  return withDataContext(async ({ client, userId }) => {
    const rows = checked(await client.from("attachments").select("id,original_name,mime_type,size,storage_path,extracted_text")
      .eq("user_id", userId).eq("message_id", messageId).order("created_at")) as Row[];
    return rows.map((row) => ({
      id: row.id as string, originalName: row.original_name as string, mimeType: row.mime_type as string,
      size: Number(row.size), storagePath: row.storage_path as string, extractedText: row.extracted_text as string | null,
    }));
  });
}

export async function updateAttachmentText(id: string, text: string) {
  return withDataContext(async ({ client, userId }) => checked(await client.from("attachments").update({ extracted_text: text })
    .eq("user_id", userId).eq("id", id)));
}

export async function createMessageJob(messageId: string, jobId = randomUUID()) {
  return withDataContext(async ({ client, userId }) => {
    checked(await client.from("processing_jobs").insert({ id: jobId, user_id: userId, user_message_id: messageId, status: "queued" }));
    return jobId;
  });
}

export async function listWallets(): Promise<WalletView[]> {
  return withDataContext(async ({ client, userId }) => {
    await generateDueRecurrences();
    const [walletResult, transactionResult, transferResult, adjustmentResult] = await Promise.all([
      client.from("wallets").select("id,name,kind,opening_balance_cents,is_default,created_at").eq("user_id", userId),
      client.from("transactions").select("wallet_id,direction,amount_cents").eq("user_id", userId),
      client.from("wallet_transfers").select("from_wallet_id,to_wallet_id,amount_cents").eq("user_id", userId),
      client.from("wallet_adjustments").select("wallet_id,direction,amount_cents").eq("user_id", userId),
    ]);
    const wallets = checked(walletResult) as Row[];
    const transactions = checked(transactionResult) as Row[];
    const transfers = checked(transferResult) as Row[];
    const adjustments = checked(adjustmentResult) as Row[];
    return wallets.map((wallet) => {
      const id = String(wallet.id);
      const txCents = transactions.filter((row) => row.wallet_id === id).reduce((sum, row) => sum + (row.direction === "income" ? 1 : -1) * Number(row.amount_cents), 0);
      const transferCents = transfers.reduce((sum, row) => sum + (row.to_wallet_id === id ? Number(row.amount_cents) : 0) - (row.from_wallet_id === id ? Number(row.amount_cents) : 0), 0);
      const adjustCents = adjustments.filter((row) => row.wallet_id === id).reduce((sum, row) => sum + (row.direction === "credit" ? 1 : -1) * Number(row.amount_cents), 0);
      return { id, name: wallet.name, kind: wallet.kind, openingBalanceCents: Number(wallet.opening_balance_cents), balanceCents: Number(wallet.opening_balance_cents) + txCents + transferCents + adjustCents, isDefault: Boolean(wallet.is_default) };
    });
  });
}

export async function createWallet(input: { name: string; kind: WalletKind; openingBalanceCents: number }) {
  return withDataContext(async ({ client, userId }) => {
    assertAmount(input.openingBalanceCents, true);
    const id = randomUUID();
    checked(await client.from("wallets").insert({ id, user_id: userId, name: input.name.trim(), kind: input.kind, opening_balance_cents: input.openingBalanceCents }));
    return id;
  });
}

export async function updateWallet(input: { id: string; name: string; openingBalanceCents: number }) {
  return withDataContext(async ({ client, userId }) => {
    assertAmount(input.openingBalanceCents, true);
    const data = checked(await client.from("wallets").update({ name: input.name.trim(), opening_balance_cents: input.openingBalanceCents })
      .eq("user_id", userId).eq("id", input.id).select("id"));
    if (!data.length) throw new Error("Carteira não encontrada.");
  });
}

export async function transferWalletFunds(input: { fromWalletId: string; toWalletId: string | null; createDestination?: { name: string; kind: WalletKind }; amountCents: number; description: string }) {
  return withDataContext(async ({ client, userId }) => {
    assertAmount(input.amountCents);
    const { data, error } = await client.rpc("create_wallet_transfer", {
      p_user_id: userId, p_from_wallet_id: input.fromWalletId, p_to_wallet_id: input.toWalletId, p_create_name: input.createDestination?.name ?? null,
      p_create_kind: input.createDestination?.kind ?? null, p_amount_cents: input.amountCents, p_description: input.description,
    });
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as Row;
    return { id: String(row.id), toWalletId: String(row.to_wallet_id) };
  });
}

export async function adjustWalletBalance(input: { walletId: string; direction: "credit" | "debit"; amountCents: number; description: string }) {
  return withDataContext(async ({ client, userId }) => {
    assertAmount(input.amountCents);
    const id = randomUUID();
    checked(await client.from("wallet_adjustments").insert({ id, user_id: userId, wallet_id: input.walletId, direction: input.direction, amount_cents: input.amountCents, description: input.description.trim(), occurred_on: localDate() }));
    return id;
  });
}

export async function setWalletBalance(input: { walletId: string; balanceCents: number; description: string }) {
  const wallets = await listWallets();
  const wallet = wallets.find((row) => row.id === input.walletId);
  if (!wallet) throw new Error("Carteira não encontrada.");
  const delta = input.balanceCents - wallet.balanceCents;
  if (!delta) return 0;
  return adjustWalletBalance({ walletId: wallet.id, direction: delta > 0 ? "credit" : "debit", amountCents: Math.abs(delta), description: input.description });
}

export async function createTransaction(input: { direction: Direction; amountCents: number; description: string; merchant: string | null; occurredOn: string; sourceMessageId: string | null; categoryIds: string[]; walletId?: string }) {
  return withDataContext(async ({ client, userId }) => {
    assertAmount(input.amountCents);
    const wallets = checked(await client.from("wallets").select("id,is_default").eq("user_id", userId)) as Row[];
    const walletId = input.walletId ?? wallets.find((wallet) => wallet.is_default)?.id;
    if (!walletId || !wallets.some((wallet) => wallet.id === walletId)) throw new Error("Conta de destino não encontrada.");
    const id = randomUUID();
    const { error } = await client.rpc("create_finance_transaction", {
      p_user_id: userId, p_id: id, p_direction: input.direction, p_amount_cents: input.amountCents,
      p_description: input.description, p_merchant: input.merchant, p_occurred_on: input.occurredOn,
      p_wallet_id: walletId, p_source_message_id: input.sourceMessageId, p_category_ids: input.categoryIds,
    });
    if (error) throw new Error(error.message);
    return id;
  });
}

export async function updateTransaction(input: { id: string; direction: Direction; amountCents: number; description: string; merchant: string | null; occurredOn: string; categoryIds: string[] }) {
  return withDataContext(async ({ client, userId }) => {
    assertAmount(input.amountCents);
    const { error } = await client.rpc("update_finance_transaction", {
      p_user_id: userId, p_id: input.id, p_direction: input.direction, p_amount_cents: input.amountCents,
      p_description: input.description, p_merchant: input.merchant, p_occurred_on: input.occurredOn, p_category_ids: input.categoryIds,
    });
    if (error) throw new Error(error.message);
    if (input.merchant && input.categoryIds.length) checked(await client.from("merchant_rules").upsert({
      id: randomUUID(), user_id: userId, merchant_key: normalizeMerchant(input.merchant), category_ids_json: input.categoryIds, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,merchant_key" }));
  });
}

export async function deleteTransaction(id: string) {
  return withDataContext(async ({ client, userId }) => {
    const rows = checked(await client.from("transactions").delete().eq("user_id", userId).eq("id", id).select("id"));
    return rows.length > 0;
  });
}

export async function getTransactionSourceMessage(id: string) {
  return withDataContext(async ({ client, userId }) => {
    const { data, error } = await client.from("transactions").select("source_message_id").eq("user_id", userId).eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.source_message_id as string | null | undefined;
  });
}

export async function listTransactions(limit = 200): Promise<TransactionView[]> {
  return withDataContext(async ({ client, userId }) => {
    await generateDueRecurrences();
    const rows = checked(await client.from("transactions").select("id,direction,amount_cents,description,merchant,occurred_on,created_at")
      .eq("user_id", userId).order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).limit(Math.min(limit, 200))) as Row[];
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id as string);
    const links = checked(await client.from("transaction_categories").select("transaction_id,category_id").eq("user_id", userId).in("transaction_id", ids)) as Row[];
    const categoryIds = [...new Set(links.map((row) => row.category_id as string))];
    const categories = categoryIds.length ? checked(await client.from("categories").select("id,name").eq("user_id", userId).in("id", categoryIds)) as Row[] : [];
    const names = new Map(categories.map((row) => [row.id as string, row.name as string]));
    const byTransaction = new Map<string, string[]>();
    for (const link of links) byTransaction.set(link.transaction_id, [...(byTransaction.get(link.transaction_id) ?? []), names.get(link.category_id)].filter((value): value is string => Boolean(value)));
    return rows.map((row) => ({
      id: row.id, direction: row.direction, amountCents: Number(row.amount_cents), description: row.description,
      merchant: row.merchant, occurredOn: String(row.occurred_on), categories: byTransaction.get(row.id) ?? [],
    })) as TransactionView[];
  });
}

export async function report(options: { period: "today" | "week" | "month" | "all" | "custom"; start?: string | null; end?: string | null; categoryNames?: string[]; groupBy?: "day" | "week" | "month" | "category" | null }): Promise<ReportResult> {
  return withDataContext(async ({ client, userId }) => {
    await generateDueRecurrences();
    const period = periodFor(options.period, options.start, options.end);
    const allCategories = await getCategories();
    const selectedIds = (options.categoryNames ?? []).map((name) => allCategories.find((category) => category.name.toLowerCase() === name.toLowerCase())?.id).filter((id): id is string => Boolean(id));
    let query = client.from("transactions").select("id,direction,amount_cents,description,merchant,occurred_on").eq("user_id", userId).gte("occurred_on", period.start).lte("occurred_on", period.end);
    const transactions = checked(await query.order("occurred_on")) as Row[];
    const ids = transactions.map((row) => row.id as string);
    const links = ids.length ? checked(await client.from("transaction_categories").select("transaction_id,category_id").eq("user_id", userId).in("transaction_id", ids)) as Row[] : [];
    const selected = new Set(selectedIds);
    const linkMap = new Map<string, string[]>();
    for (const link of links) linkMap.set(link.transaction_id, [...(linkMap.get(link.transaction_id) ?? []), link.category_id]);
    const filtered = selectedIds.length ? transactions.filter((row) => (linkMap.get(row.id) ?? []).some((categoryId) => selected.has(categoryId))) : transactions;
    const expenses = filtered.filter((row) => row.direction === "expense");
    const expenseCents = filtered.reduce((sum, row) => sum + (row.direction === "expense" ? Number(row.amount_cents) : 0), 0);
    const incomeCents = filtered.reduce((sum, row) => sum + (row.direction === "income" ? Number(row.amount_cents) : 0), 0);
    const categoryMap = new Map(allCategories.map((category) => [category.id, category.name]));
    const categoryTotals = new Map<string, { cents: number; ids: Set<string> }>();
    const merchantTotals = new Map<string, { cents: number; ids: Set<string> }>();
    for (const row of expenses) {
      const key = String(row.merchant || row.description);
      const merchant = merchantTotals.get(key) ?? { cents: 0, ids: new Set<string>() };
      merchant.cents += Number(row.amount_cents); merchant.ids.add(row.id); merchantTotals.set(key, merchant);
      for (const categoryId of linkMap.get(row.id) ?? []) {
        const name = categoryMap.get(categoryId);
        if (!name) continue;
        const category = categoryTotals.get(name) ?? { cents: 0, ids: new Set<string>() };
        category.cents += Number(row.amount_cents); category.ids.add(row.id); categoryTotals.set(name, category);
      }
    }
    const rowsFrom = (map: Map<string, { cents: number; ids: Set<string> }>) => [...map].map(([name, value]) => ({ name, cents: value.cents, count: value.ids.size })).sort((a, b) => b.cents - a.cents);
    const categoryRows = rowsFrom(categoryTotals);
    const merchantRows = rowsFrom(merchantTotals).slice(0, 10);
    const groupBy = options.groupBy ?? (options.period === "all" ? "month" : "day");
    let chart: ChartSpec | null;
    if (groupBy === "category" || selectedIds.length) {
      const rows = selectedIds.length ? merchantRows : categoryRows;
      chart = { type: "bar", title: selectedIds.length ? "Gastos por estabelecimento" : "Gastos por categoria", data: rows.slice(0, 10).map((row) => ({ label: row.name, value: row.cents })) };
    } else {
      const buckets = new Map<string, { label: string; income: number; expense: number }>();
      for (const row of filtered) {
        const label = chartDate(String(row.occurred_on), groupBy as "day" | "week" | "month");
        const bucket = buckets.get(label) ?? { label, income: 0, expense: 0 };
        bucket[row.direction as "income" | "expense"] += Number(row.amount_cents);
        buckets.set(label, bucket);
      }
      chart = { type: "line", title: "Entradas e saídas", data: [...buckets.values()].sort((a, b) => a.label.localeCompare(b.label)) };
    }
    return { periodLabel: period.label, expenseCents, incomeCents, netCents: incomeCents - expenseCents, count: filtered.length, categoryRows, merchantRows, chart };
  });
}

export async function createRecurrence(input: { name: string; direction: Direction; amountCents: number; merchant: string | null; description: string; frequency: "weekly" | "monthly" | "yearly"; startOn: string; endOn: string | null; categoryIds: string[] }) {
  return withDataContext(async ({ client, userId }) => {
    assertAmount(input.amountCents);
    const id = randomUUID();
    checked(await client.from("recurrence_rules").insert({
      id, user_id: userId, name: input.name, direction: input.direction, amount_cents: input.amountCents, merchant: input.merchant,
      description: input.description, frequency: input.frequency, start_on: input.startOn, end_on: input.endOn,
      category_ids_json: input.categoryIds, active: true,
    }));
    await generateDueRecurrences();
    return id;
  });
}

export async function listRecurrences() {
  return withDataContext(async ({ client, userId }) => {
    await generateDueRecurrences();
    const rows = checked(await client.from("recurrence_rules").select("id,name,direction,amount_cents,merchant,description,frequency,start_on,end_on,category_ids_json,active")
      .eq("user_id", userId).order("active", { ascending: false }).order("created_at", { ascending: false })) as Row[];
    return rows.map((row) => ({
      id: row.id, name: row.name, direction: row.direction, amountCents: Number(row.amount_cents), merchant: row.merchant,
      description: row.description, frequency: row.frequency, startOn: String(row.start_on), endOn: row.end_on ? String(row.end_on) : null,
      categoryIdsJson: JSON.stringify(row.category_ids_json), active: row.active,
    })) as Array<Record<string, unknown>>;
  });
}

export async function toggleRecurrence(id: string, active: boolean) {
  return withDataContext(async ({ client, userId }) => {
    const rows = checked(await client.from("recurrence_rules").update({ active }).eq("user_id", userId).eq("id", id).select("id"));
    if (!rows.length) throw new Error("Recorrência não encontrada.");
  });
}

export async function updateRecurrence(input: { id: string; name: string; direction: Direction; amountCents: number; merchant: string | null; description: string; frequency: "weekly" | "monthly" | "yearly"; startOn: string; endOn: string | null; categoryIds: string[] }) {
  return withDataContext(async ({ client, userId }) => {
    assertAmount(input.amountCents);
    const { error } = await client.rpc("update_recurrence_rule", {
      p_user_id: userId, p_id: input.id, p_name: input.name, p_direction: input.direction,
      p_amount_cents: input.amountCents, p_merchant: input.merchant, p_description: input.description,
      p_frequency: input.frequency, p_start_on: input.startOn, p_end_on: input.endOn, p_category_ids: input.categoryIds,
    });
    if (error) throw new Error(error.message);
  });
}

export async function deleteRecurrence(id: string) {
  return withDataContext(async ({ client, userId }) => {
    const rows = checked(await client.from("recurrence_rules").delete().eq("user_id", userId).eq("id", id).select("id"));
    return rows.length > 0;
  });
}

export async function generateDueRecurrences() {
  return withDataContext(async ({ client, userId }) => {
    const { error } = await client.rpc("materialize_recurrences", { p_user_id: userId });
    if (error) throw new Error(error.message);
  });
}

export async function getMessageForProcessing(messageId: string) {
  return withDataContext(async ({ client, userId }) => {
    const { data, error } = await client.from("messages").select("content").eq("user_id", userId).eq("id", messageId).eq("role", "user").maybeSingle();
    if (error) throw new Error(error.message);
    return data?.content as string | undefined;
  });
}

export async function getProcessingJob(jobId: string) {
  return withDataContext(async ({ client, userId }) => {
    const { data, error } = await client.from("processing_jobs").select("id,user_message_id,status,error,created_at,updated_at")
      .eq("user_id", userId).eq("id", jobId).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });
}

export async function listPendingProcessingJobs() {
  return withDataContext(async ({ client, userId }) => {
    const { data, error } = await client.from("processing_jobs").select("id,status")
      .eq("user_id", userId).in("status", ["queued", "processing"]).order("created_at");
    if (error) throw new Error(error.message);
    return data ?? [];
  });
}

export async function exportUserData() {
  return withDataContext(async ({ client, userId, user }) => {
    const tables = ["categories", "wallets", "messages", "attachments", "wallet_transfers", "wallet_adjustments", "recurrence_rules", "transactions", "transaction_categories", "merchant_rules"];
    const records: Record<string, Row[]> = {};
    for (const table of tables) {
      const { data, error } = await client.from(table).select("*").eq("user_id", userId);
      if (error) throw new Error(error.message);
      records[table] = (data ?? []) as Row[];
    }
    const attachments = await Promise.all(records.attachments.map(async (row) => {
      const { data, error } = await client.storage.from("finance-attachments").download(String(row.storage_path));
      if (error || !data) throw new Error("Não foi possível incluir todos os anexos na exportação.");
      return { id: row.id, originalName: row.original_name, mimeType: row.mime_type, size: Number(row.size), contentBase64: Buffer.from(await data.arrayBuffer()).toString("base64") };
    }));
    return { format: "arcadya-finances-export-v1", exportedAt: new Date().toISOString(), user: { id: userId, email: user?.email ?? null }, records, attachmentFiles: attachments };
  });
}

export async function getMessageIdForProcessingJob(jobId: string) {
  return withDataContext(async ({ client, userId }) => {
    const { data, error } = await client.from("processing_jobs").select("user_message_id").eq("user_id", userId).eq("id", jobId).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.user_message_id as string | undefined;
  });
}

export async function updateProcessingJob(messageId: string, status: "queued" | "processing" | "done" | "failed", errorMessage: string | null = null) {
  return withDataContext(async ({ client, userId }) => checked(await client.from("processing_jobs").update({ status, error: errorMessage, updated_at: new Date().toISOString(), locked_until: null })
    .eq("user_id", userId).eq("user_message_id", messageId)));
}
