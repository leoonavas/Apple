import "server-only";
import type { AssistantIntent as ParsedIntent } from "./schema";
import { addMessage, adjustWalletBalance, createRecurrence, createTransaction, createWallet, getCategories, getMessageForProcessing, listWallets, report, resolveCategoryIds, setWalletBalance, sourceAttachments, transferWalletFunds, updateAttachmentText, updateProcessingJob, updateWallet, type WalletKind, type WalletView } from "@/lib/finance/service";
import { withPrivilegedUser } from "@/lib/supabase/data-context";
import { localDate } from "@/lib/finance/dates";
import { MAX_TRANSACTION_AMOUNT_CENTS, moneyMarkdown, normalizeMerchant, parseMoney, parseNonNegativeMoney, parseTransactionAmount } from "@/lib/finance/money";
import type { ChartSpec } from "@/lib/finance/types";

const currency = (cents: number) => moneyMarkdown(cents);
const maxTransactionAmount = currency(MAX_TRANSACTION_AMOUNT_CENTS);

export async function completeAnalyzedMessage(messageId: string, userId: string, analysis: {
  parsed: ParsedIntent;
  extractedTexts: Array<{ attachmentId: string; text: string }>;
  errors: string[];
  usedLocalModel: boolean;
}) {
  return withPrivilegedUser(userId, async () => {
    try {
      const userText = await getMessageForProcessing(messageId);
      if (userText === undefined) throw new Error("Mensagem não encontrada.");
      const files = await sourceAttachments(messageId);
      const allowedIds = new Set(files.map((file) => file.id));
      const extracted = analysis.extractedTexts.filter((entry) => allowedIds.has(entry.attachmentId));
      for (const entry of extracted) await updateAttachmentText(entry.attachmentId, entry.text.slice(0, 100_000));
      const allText = [userText, ...extracted.map((entry) => entry.text)].filter(Boolean).join("\n\n").trim();
      const result = await executeIntent(analysis.parsed, { messageId, userText, allText });
      if (analysis.errors.length) result.content += `\n\n> Alguns anexos não puderam ser processados localmente. ${analysis.errors.map((error) => error.split(":")[0]).join(", ")}. Confira a instalação das ferramentas de áudio/OCR no README.`;
      if (!analysis.usedLocalModel && !analysis.errors.length && analysis.parsed.intent === "unsupported") result.content = "Ainda não consegui interpretar esse pedido. Você pode registrar entradas e saídas, criar ou consultar carteiras, guardar/transferir dinheiro entre elas, criar recorrências, pedir relatórios ou solicitar sugestões financeiras.";
      const replyId = await addMessage("assistant", result.content, result.chart);
      await updateProcessingJob(messageId, "done");
      return { replyId, content: result.content, chart: result.chart };
    } catch (error) {
      await updateProcessingJob(messageId, "failed", error instanceof Error ? error.message.slice(0, 500) : "Falha no processamento.").catch(() => undefined);
      throw error;
    }
  });
}

async function executeIntent(parsed: ParsedIntent, context: { messageId: string; userText: string; allText: string }): Promise<{ content: string; chart: ChartSpec | null }> {
  if (parsed.intent === "wallet") return executeWalletIntent(parsed.wallet ?? null);

  if (parsed.intent === "transaction") {
    if (!parsed.transactions.length) return clarification(parsed.clarification ?? "Não encontrei um lançamento no pedido.");
    const target = await transactionWallet(context.allText);
    if (target.question) return clarification(target.question);
    const saved: Array<{ id: string; amount: number; direction: string; description: string; merchant: string | null; categories: string[] }> = [];
    let needsClarification = false;
    let amountOutOfRange = false;
    for (const candidate of parsed.transactions) {
      const rawAmountCents = candidate.amount ? parseMoney(candidate.amount) : null;
      const amountCents = candidate.amount ? parseTransactionAmount(candidate.amount) : null;
      if (rawAmountCents !== null && amountCents === null) amountOutOfRange = true;
      if (!amountCents || !candidate.direction || candidate.confidence < 0.55) { needsClarification = true; continue; }
      const merchant = explicitRecipient(context.userText) ?? candidate.merchant;
      const categoryIds = await resolveCategoryIds(candidate.categories, merchant, context.userText);
      const id = await createTransaction({
        direction: candidate.direction,
        amountCents,
        description: candidate.description?.trim() || (candidate.direction === "income" ? "Entrada" : "Saída"),
        merchant,
        occurredOn: validDate(candidate.occurredOn) ?? localDate(),
        sourceMessageId: context.messageId,
        categoryIds,
        walletId: target.wallet?.id,
      });
      const categoryRows = await getCategories();
      const categoryNames = categoryIds.map((categoryId) => categoryRows.find((category) => category.id === categoryId)?.name).filter(Boolean);
      saved.push({ id, amount: amountCents, direction: candidate.direction, description: candidate.description ?? "Movimentação", merchant, categories: categoryNames as string[] });
    }
    if (saved.length) {
      const lines = saved.map((item) => `- **${item.direction === "income" ? "Entrada" : "Saída"}:** ${currency(item.amount)}${item.merchant ? ` em **${escapeMd(item.merchant)}**` : ""}${item.categories.length ? `\n  - Categorias: ${item.categories.map(escapeMd).join(", ")}` : ""}`);
      const followUp = needsClarification ? `\n\n${amountOutOfRange ? `Um valor ultrapassou o limite seguro de ${maxTransactionAmount} e não foi salvo. Confirme esse valor.` : "Um dos valores não foi salvo porque faltou valor ou direção. Você pode completar essa informação em outra mensagem."}` : "";
      return { content: `Registrei ${saved.length === 1 ? "a movimentação" : "as movimentações"}:\n\n${lines.join("\n")}${followUp}`, chart: null };
    }
    if (amountOutOfRange) return clarification(`O valor reconhecido ultrapassou o limite seguro de ${maxTransactionAmount}. Confirme o valor para eu não registrar uma quantia incorreta.`);
    return clarification(parsed.clarification ?? "Qual foi o valor e essa movimentação foi uma entrada ou uma saída?");
  }

  if (parsed.intent === "recurrence") {
    const item = parsed.recurrence;
    if (!item) return clarification("Informe o valor, se é uma entrada ou uma saída, e a frequência.");
    const rawAmountCents = item.amount ? parseMoney(item.amount) : null;
    const amountCents = item.amount ? parseTransactionAmount(item.amount) : null;
    if (rawAmountCents !== null && amountCents === null) return clarification(`O valor reconhecido ultrapassou o limite seguro de ${maxTransactionAmount}. Confirme o valor da recorrência.`);
    if (!amountCents || !item.direction || !item.frequency) return clarification(`Para criar a recorrência, informe um valor de até ${maxTransactionAmount}, se é entrada ou saída e se acontece toda semana, mês ou ano.`);
    const merchant = explicitRecipient(context.userText) ?? item.merchant;
    const categoryIds = await resolveCategoryIds(item.categories, merchant, context.userText);
    const startOn = validDate(item.startOn) ?? localDate();
    await createRecurrence({ name: item.name ?? (item.direction === "income" ? "Entrada recorrente" : "Gasto recorrente"), direction: item.direction, amountCents, merchant, description: item.description ?? item.name ?? "Movimentação recorrente", frequency: item.frequency, startOn, endOn: validDate(item.endOn), categoryIds });
    return { content: `Criei a recorrência **${escapeMd(item.name ?? "Movimentação recorrente")}** de ${currency(amountCents)}, com frequência ${item.frequency === "monthly" ? "mensal" : item.frequency === "weekly" ? "semanal" : "anual"}. A primeira ocorrência foi registrada se a data já chegou.`, chart: null };
  }

  if (parsed.intent === "report") {
    const filters = parsed.report;
    const reportResult = await report({ period: filters?.period ?? "all", start: filters?.start, end: filters?.end, categoryNames: filters?.categories ?? [], groupBy: filters?.groupBy });
    const categoryLine = filters?.categories?.length ? `\n**Filtro:** ${filters.categories.map(escapeMd).join(", ")}` : "";
    if (!reportResult.count) return { content: `Não encontrei movimentações em **${reportResult.periodLabel}**.${categoryLine}\n\nQuando você registrar entradas ou saídas, elas aparecerão aqui.`, chart: reportResult.chart };
    const rows = filters?.categories?.length ? reportResult.merchantRows : reportResult.categoryRows;
    const lines = rows.slice(0, 6).map((row) => `- ${escapeMd(row.name)}: **${currency(row.cents)}** (${row.count} ${row.count === 1 ? "lançamento" : "lançamentos"})`).join("\n");
    const categorySummary = lines ? `\n\n**${filters?.categories?.length ? "Estabelecimentos" : "Categorias com mais gastos"}**\n${lines}` : "";
    const overlap = reportResult.categoryRows.length > 1 ? "\n\n_Categorias podem se sobrepor: uma compra com mais de uma etiqueta aparece em cada categoria, mas só uma vez no total geral._" : "";
    return { content: `## Relatório — ${reportResult.periodLabel}${categoryLine}\n\n- **Entradas:** ${currency(reportResult.incomeCents)}\n- **Saídas:** ${currency(reportResult.expenseCents)}\n- **Resultado do período:** ${currency(reportResult.netCents)}\n- **Movimentações:** ${reportResult.count}${categorySummary}${overlap}`, chart: reportResult.chart };
  }

  if (parsed.intent === "advice") return { content: await buildAdvice(parsed.adviceTopic ?? "general"), chart: null };
  if (parsed.intent === "clarification") return clarification(parsed.clarification ?? "Pode dar mais detalhes para eu registrar isso corretamente?");
  return { content: "Posso registrar entradas e saídas, criar valores recorrentes, consultar gastos ou sugerir ajustes de orçamento. O que você gostaria de fazer?", chart: null };
}

async function transactionWallet(text: string): Promise<{ wallet: WalletView | null; question: string | null }> {
  const normalized = normalizeMerchant(text);
  const wallets = await listWallets();
  const explicit = wallets.filter((wallet) => {
    const name = normalizeMerchant(wallet.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b(?:na|no|da|do|de|em|para|pra|pela|pelo)\\s+(?:(?:minha|meu)\\s+)?(?:carteira\\s+)?${name}\\b`).test(normalized);
  }).sort((a, b) => b.name.length - a.name.length);
  if (explicit.length) return { wallet: explicit[0], question: null };
  const kind = /\b(?:na|no|da|do|de|em|para|pra)\s+(?:(?:minha|meu)\s+)?(?:carteira\s+de\s+)?(?:poupanca|caixinha|cofrinho)\b/.test(normalized) ? "savings"
    : /\b(?:na|no|da|do|de|em|para|pra)\s+(?:(?:minha|meu)\s+)?(?:carteira\s+de\s+)?investimentos?\b/.test(normalized) ? "investment"
      : /\b(?:na|no|da|do|de|em|para|pra)\s+(?:(?:minha|meu)\s+)?conta corrente\b/.test(normalized) ? "checking" : null;
  if (kind) {
    const reference = resolveWalletReference(wallets, null, kind);
    if (reference.ambiguous) return { wallet: null, question: `qual carteira de ${walletKindLabel(kind)} deve receber essa movimentação?` };
    if (!reference.wallet) return { wallet: null, question: `não encontrei uma carteira de ${walletKindLabel(kind)}. Crie-a primeiro pelo chat.` };
    return { wallet: reference.wallet, question: null };
  }
  if (/\b(?:na|no|da|do|de|em|para|pra)\s+(?:(?:minha|meu)\s+)?carteira\s+[a-z]/.test(normalized)) {
    return { wallet: null, question: "qual carteira existente deve receber essa movimentação?" };
  }
  return { wallet: null, question: null };
}

async function executeWalletIntent(action: NonNullable<ParsedIntent["wallet"]> | null): Promise<{ content: string; chart: null }> {
  if (!action) return walletClarification("o que você quer fazer com a carteira?");
  const wallets = await listWallets();
  const reference = resolveWalletReference(wallets, action.walletName, action.walletKind);

  if (action.action === "balance") {
    if (reference.ambiguous) return walletClarification(`qual carteira de ${walletKindLabel(action.walletKind)} você quer consultar?`);
    if (reference.wallet) return { content: `**Saldo atual — ${escapeMd(reference.wallet.name)}:** ${currency(reference.wallet.balanceCents)}`, chart: null };
    const rows = action.walletKind ? wallets.filter((wallet) => wallet.kind === action.walletKind) : wallets;
    if (!rows.length) return { content: `Ainda não há carteira de ${walletKindLabel(action.walletKind)} cadastrada. Você pode pedir, por exemplo: **“Crie uma carteira de poupança chamada Reserva.”**`, chart: null };
    const lines = rows.map((wallet) => `- **${escapeMd(wallet.name)}** · ${walletKindLabel(wallet.kind)}: ${currency(wallet.balanceCents)}`);
    const total = rows.reduce((sum, wallet) => sum + wallet.balanceCents, 0);
    const heading = action.walletKind ? `## Saldo em ${walletKindLabel(action.walletKind)}` : "## Saldos das carteiras";
    return { content: `${heading}\n\n${lines.join("\n")}\n\n**Total:** ${currency(total)}`, chart: null };
  }

  if (action.action === "create") {
    const kind = action.walletKind;
    if (!kind) return walletClarification("a carteira será de conta corrente, poupança ou investimento?");
    const name = action.walletName?.trim() || defaultWalletName(kind);
    const duplicate = wallets.find((wallet) => normalizeMerchant(wallet.name) === normalizeMerchant(name));
    if (duplicate) return { content: `A carteira **${escapeMd(duplicate.name)}** já existe e está com saldo de **${currency(duplicate.balanceCents)}**.`, chart: null };
    const openingBalanceCents = action.amount ? parseNonNegativeMoney(action.amount) : 0;
    if (openingBalanceCents === null) return walletClarification("qual é o saldo inicial válido dessa carteira?");
    await createWallet({ name, kind, openingBalanceCents });
    return { content: `Criei a carteira **${escapeMd(name)}** em **${walletKindLabel(kind)}** com saldo inicial de **${currency(openingBalanceCents)}**.`, chart: null };
  }

  if (action.action === "rename") {
    if (reference.ambiguous) return walletClarification("qual carteira você quer renomear?");
    if (!reference.wallet) return walletClarification("qual carteira existente você quer renomear?");
    const newName = action.newName?.trim();
    if (!newName || newName.length < 2) return walletClarification(`qual deve ser o novo nome de **${escapeMd(reference.wallet.name)}**?`);
    if (wallets.some((wallet) => wallet.id !== reference.wallet!.id && normalizeMerchant(wallet.name) === normalizeMerchant(newName))) {
      return walletClarification(`já existe outra carteira chamada **${escapeMd(newName)}**. Escolha um nome diferente.`);
    }
    await updateWallet({ id: reference.wallet.id, name: newName, openingBalanceCents: reference.wallet.openingBalanceCents });
    return { content: `Renomeei a carteira para **${escapeMd(newName)}**. O saldo continua em **${currency(reference.wallet.balanceCents)}**.`, chart: null };
  }

  if (action.action === "transfer") {
    const amountCents = action.amount ? parseTransactionAmount(action.amount) : null;
    if (!amountCents) return walletClarification("qual valor você quer guardar ou transferir?");
    const sourceReference = resolveWalletReference(wallets, action.sourceWalletName, action.sourceWalletKind ?? (action.sourceWalletName ? null : "checking"));
    if (sourceReference.ambiguous) return walletClarification("de qual carteira o dinheiro deve sair?");
    if (!sourceReference.wallet) return walletClarification("de qual carteira o dinheiro deve sair?");
    if (reference.ambiguous) return walletClarification(`para qual carteira de ${walletKindLabel(action.walletKind)} devo transferir?`);
    let createDestination: { name: string; kind: WalletKind } | undefined;
    if (!reference.wallet) {
      if (!action.walletKind) return walletClarification("para qual carteira e tipo devo transferir esse valor?");
      if (action.walletName && action.walletKind === "checking") return walletClarification(`não encontrei a carteira **${escapeMd(action.walletName)}**. Quer que eu a crie?`);
      createDestination = { name: action.walletName?.trim() || defaultWalletName(action.walletKind), kind: action.walletKind };
    }
    try {
      const result = await transferWalletFunds({
        fromWalletId: sourceReference.wallet.id,
        toWalletId: reference.wallet?.id ?? null,
        createDestination,
        amountCents,
        description: action.description?.trim() || "Transferência entre carteiras",
      });
      const destination = (await listWallets()).find((wallet) => wallet.id === result.toWalletId)!;
      return { content: `Transferi **${currency(amountCents)}** de **${escapeMd(sourceReference.wallet.name)}** para **${escapeMd(destination.name)}**.\n\nEssa movimentação altera os saldos das carteiras, mas não entra como renda ou gasto nos relatórios.`, chart: null };
    } catch (error) {
      return walletClarification(error instanceof Error ? error.message : "não consegui concluir a transferência.");
    }
  }

  if (action.action === "add_balance" || action.action === "remove_balance") {
    const amountCents = action.amount ? parseTransactionAmount(action.amount) : null;
    if (!amountCents) return walletClarification("qual valor devo adicionar ou retirar?");
    if (reference.ambiguous) return walletClarification(`em qual carteira de ${walletKindLabel(action.walletKind)} devo fazer o ajuste?`);
    let wallet = reference.wallet;
    if (!wallet && action.action === "add_balance" && action.walletKind) {
      const name = action.walletName?.trim() || defaultWalletName(action.walletKind);
      const duplicate = wallets.find((item) => normalizeMerchant(item.name) === normalizeMerchant(name));
      if (duplicate) wallet = duplicate;
      else {
        await createWallet({ name, kind: action.walletKind, openingBalanceCents: amountCents });
        return { content: `Criei **${escapeMd(name)}** com saldo de **${currency(amountCents)}**. Esse ajuste de carteira não aparece como renda nos relatórios.`, chart: null };
      }
    }
    if (!wallet) return walletClarification("qual carteira existente deve receber esse ajuste?");
    try {
      await adjustWalletBalance({ walletId: wallet.id, direction: action.action === "add_balance" ? "credit" : "debit", amountCents, description: action.description?.trim() || "Ajuste de saldo pelo chat" });
      return { content: action.action === "add_balance"
        ? `Adicionei **${currency(amountCents)}** ao saldo de **${escapeMd(wallet.name)}**. Esse ajuste não é contado como renda nos relatórios.`
        : `Retirei **${currency(amountCents)}** do saldo de **${escapeMd(wallet.name)}**. Esse ajuste não é contado como gasto nos relatórios.`, chart: null };
    } catch (error) {
      return walletClarification(error instanceof Error ? error.message : "não consegui ajustar o saldo.");
    }
  }

  if (action.action === "set_balance") {
    const amountCents = action.amount ? parseNonNegativeMoney(action.amount) : null;
    if (amountCents === null) return walletClarification("qual deve ser o saldo atual da carteira?");
    if (reference.ambiguous) return walletClarification(`qual carteira de ${walletKindLabel(action.walletKind)} você quer ajustar?`);
    if (!reference.wallet) return walletClarification("qual carteira existente você quer ajustar?");
    const delta = await setWalletBalance({ walletId: reference.wallet.id, balanceCents: amountCents, description: action.description?.trim() || "Saldo ajustado pelo chat" });
    return { content: `Atualizei o saldo de **${escapeMd(reference.wallet.name)}** para **${currency(amountCents)}**${delta ? ". O ajuste foi registrado sem alterar renda ou gastos." : "; ele já estava nesse valor."}`, chart: null };
  }

  return walletClarification("qual ação você quer fazer com essa carteira?");
}

function resolveWalletReference(wallets: WalletView[], name: string | null, kind: WalletKind | null) {
  if (name) {
    const normalized = normalizeMerchant(name);
    const exact = wallets.find((wallet) => normalizeMerchant(wallet.name) === normalized);
    if (exact) return { wallet: exact, ambiguous: false };
  }
  if (!kind) return { wallet: null, ambiguous: false };
  if (kind === "checking") {
    const main = wallets.find((wallet) => wallet.isDefault);
    if (main && (!name || normalizeMerchant(name) === normalizeMerchant(main.name))) return { wallet: main, ambiguous: false };
  }
  const matches = wallets.filter((wallet) => wallet.kind === kind);
  if (matches.length === 1) return { wallet: matches[0], ambiguous: false };
  return { wallet: null, ambiguous: matches.length > 1 };
}

function walletKindLabel(kind: WalletKind | null) {
  return kind === "checking" ? "conta corrente" : kind === "savings" ? "poupança" : kind === "investment" ? "investimentos" : "carteira";
}

function defaultWalletName(kind: WalletKind) {
  return kind === "checking" ? "Conta corrente" : kind === "savings" ? "Poupança" : "Investimentos";
}

function walletClarification(question: string) {
  return { content: `Para concluir a ação da carteira, preciso confirmar: ${question}`, chart: null };
}

async function buildAdvice(topic: string): Promise<string> {
  const month = await report({ period: "month", groupBy: "category" });
  const total = month.incomeCents;
  if (topic === "investing") {
    return `## Orientação sobre investimentos\n\n1. Defina objetivo e prazo antes de comparar opções.\n2. Considere liquidez e riscos que aceita assumir.\n3. Monte uma reserva para imprevistos antes de comprometer valores de curto prazo.\n\nNão indico ativos ou produtos específicos. A adequação depende de objetivos, situação financeira e tolerância a risco. Consulte o material educacional da [CVM](https://www.gov.br/investidor/pt-br/investir/antes-de-investir/respeite-o-seu-perfil-de-investidor/entenda-o-suitability).`;
  }
  if (!month.count) return "## Sugestão financeira\n\nAinda tenho poucos lançamentos para sugerir cortes com base no seu histórico. Registre salário, despesas fixas e gastos do dia a dia; depois posso mostrar as categorias que mais pesam e comparar entradas e saídas.";
  const top = month.categoryRows.slice(0, 3).map((row) => `- **${escapeMd(row.name)}:** ${currency(row.cents)}`).join("\n");
  const spendRate = total > 0 ? Math.round(month.expenseCents / total * 100) : null;
  const title = topic === "salary" ? "Controle do salário" : topic === "cut-spending" ? "Onde revisar gastos" : "Sugestão de orçamento";
  return `## ${title}\n\nNo mês atual, você registrou **${currency(month.incomeCents)}** em entradas e **${currency(month.expenseCents)}** em saídas.${spendRate !== null ? ` As saídas equivalem a **${spendRate}%** das entradas registradas.` : ""}\n\n**Categorias com mais gastos**\n${top}\n\n**Próximos passos**\n\n- Defina um limite mensal para as duas maiores categorias.\n- Separe primeiro as despesas fixas quando receber o salário.\n- Compare os próximos meses para verificar se o ajuste funcionou.\n\nEsta orientação usa somente os lançamentos do app e não substitui aconselhamento financeiro individual.`;
}

function clarification(question: string) { return { content: `Para registrar corretamente, preciso confirmar: ${question}`, chart: null }; }
function validDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : value;
}
function escapeMd(value: string) { return value.replace(/[\\`*_{}\[\]()#+\-.!|>]/g, "\\$&"); }
function explicitRecipient(text: string) {
  const prefixed = text.match(/(?:destinat[aá]rio|loja|estabelecimento|texto)\s*[:=-]\s*([^\n,;]{2,60})/i);
  if (prefixed) return prefixed[1].trim();
  const clean = text.trim();
  if (clean.length >= 2 && clean.length <= 50 && !/^anexo enviado\.?$/i.test(clean) && !/\d|\b(gastei|paguei|comprei|recebi|ganhei|reais|r\$)\b/i.test(clean)) return clean;
  return null;
}
