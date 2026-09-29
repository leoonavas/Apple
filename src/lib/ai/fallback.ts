import type { AssistantIntent } from "./schema";

const amountPattern = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[,.]\d{1,2})?)/i;
type WalletReference = { name: string; kind: "checking" | "savings" | "investment" };
type WalletActionFields = Omit<NonNullable<AssistantIntent["wallet"]>, "action">;

export function fallbackIntent(text: string, categories: string[], wallets: WalletReference[] = []): AssistantIntent {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const matchedCategories = categories.filter((category) => normalized.includes(category.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()));
  const wallet = detectWalletAction(text, normalized, wallets);
  if (wallet) return wallet;
  if (/quanto .*?(gastei|gasto|despesei)|relatorio|resumo|total.*?(gasto|entrada|saida)|quanto .*?(recebi|ganhei)/.test(normalized)) {
    const period = /hoje|diari/.test(normalized) ? "today" : /semana/.test(normalized) ? "week" : /mes|mensal/.test(normalized) ? "month" : "all";
    return { intent: "report", transactions: [], recurrence: null, report: { period, start: null, end: null, categories: matchedCategories, groupBy: matchedCategories.length ? "category" : period === "all" ? "month" : "day" }, adviceTopic: null, clarification: null };
  }
  if (/todo mes|mensal|assinatura|fix[oa]|todo ano|anual|toda semana|semanal/.test(normalized) && amountPattern.test(text)) {
    const found = text.match(amountPattern)?.[1] ?? null;
    const direction = /receb|salario|renda/.test(normalized) ? "income" : /pago|gastei|assinatura|debita/.test(normalized) ? "expense" : null;
    return { intent: "recurrence", transactions: [], recurrence: { name: direction === "income" ? "Entrada recorrente" : "Gasto recorrente", direction, amount: found, merchant: extractMerchant(text), description: text.trim().slice(0, 120), frequency: /semana/.test(normalized) ? "weekly" : /ano|anual/.test(normalized) ? "yearly" : "monthly", startOn: null, endOn: null, categories: matchedCategories }, report: null, adviceTopic: null, clarification: null };
  }
  if (/sugest|invest|salario|sal[aá]rial|cortar gastos|reduzir gastos|orcamento/.test(normalized)) {
    const adviceTopic = /invest/.test(normalized) ? "investing" : /cort|reduz/.test(normalized) ? "cut-spending" : /salario/.test(normalized) ? "salary" : "budget";
    return { intent: "advice", transactions: [], recurrence: null, report: null, adviceTopic, clarification: null };
  }
  const found = text.match(amountPattern)?.[1] ?? null;
  if (!found && /recebi|ganhei|entrou|sal[aá]rio|depositaram|gastei|paguei|comprei|saiu|assinatura|debitaram|compra/.test(normalized)) {
    return { intent: "clarification", transactions: [], recurrence: null, report: null, adviceTopic: null, clarification: "Qual foi o valor da entrada ou saída?" };
  }
  if (found) {
    const direction = /recebi|ganhei|entrou|sal[aá]rio|depositaram/.test(normalized) ? "income" : /gastei|paguei|comprei|sa[ií]u|assinatura|debitaram|compra/.test(normalized) ? "expense" : null;
    const productCategory = /camiseta|roupa|sapato|cal[cç]a|vestido/.test(normalized) ? "Vestuário" : null;
    const onlineCategory = /mercadolivre|mercado livre|amazon|shopee|aliexpress/.test(normalized) ? "Compras Online" : null;
    const foodCategory = (/\bmercado\b(?!\s+livre)|\bsupermercado\b|restaurante|almoco|jantar|lanche|padaria|ifood/.test(normalized)) ? "Alimentação" : null;
    const travelCategory = /uber|99\s|taxi|combustivel|gasolina|onibus|metro/.test(normalized) ? "Transporte" : null;
    const homeCategory = /aluguel|condominio|luz|energia|agua|internet/.test(normalized) ? "Moradia" : null;
    const defaults = [onlineCategory, productCategory, foodCategory, travelCategory, homeCategory].filter((x): x is string => Boolean(x));
    const finalCategories = matchedCategories.length ? matchedCategories : defaults;
    return { intent: "transaction", transactions: [{ direction, amount: found, occurredOn: null, merchant: extractMerchant(text), description: text.trim().slice(0, 120), categories: finalCategories, confidence: direction ? 0.72 : 0.35, evidence: text.trim().slice(0, 240) }], recurrence: null, report: null, adviceTopic: null, clarification: null };
  }
  return { intent: "unsupported", transactions: [], recurrence: null, report: null, adviceTopic: null, clarification: null };
}

function detectWalletAction(text: string, normalized: string, wallets: WalletReference[]): AssistantIntent | null {
  const storageAction = /\b(?:guardei|guarde|guardar|poupei|poupe|poupar|separei|separar|reservei|reservar|economizei|economizar|apliquei|aplicar|investi|investir|aportei|aportar|transferi|transferir|transfira|movi|mover)\b/.test(normalized);
  const mentionsWallet = /carteira|conta corrente|poupanca|investimento|investido|guardad|saldo|patrimonio|reserva/.test(normalized) || storageAction;
  if (!mentionsWallet) return null;
  const amount = text.match(amountPattern)?.[1] ?? null;
  const defaultFields: WalletActionFields = { walletName: null, walletKind: inferWalletKind(normalized), sourceWalletName: null, sourceWalletKind: null, amount, newName: null, description: text.trim().slice(0, 100) };
  const makeIntent = (action: NonNullable<AssistantIntent["wallet"]>["action"], fields: Partial<WalletActionFields> = {}): AssistantIntent => ({
    intent: "wallet", transactions: [], recurrence: null, report: null, adviceTopic: null, clarification: null,
    wallet: { action, ...defaultFields, ...fields },
  });

  if (/\b(?:criei|crie|cria|criar|criado|criada|cadastrei|cadastre|cadastrar|abri|abra|abrir|montei|monte|montar)\b/.test(normalized) && /carteira|conta|poupanca|investimento/.test(normalized)) {
    const kind = inferWalletKind(normalized) ?? (/(?:conta corrente|conta-corrente)/.test(normalized) ? "checking" : null);
    const newName = extractNamedWallet(text) ?? (kind ? defaultWalletName(kind) : null);
    return makeIntent("create", { walletKind: kind, walletName: newName });
  }

  if (/\b(?:renomeie|renomear|mude o nome|altere o nome|troque o nome)\b/.test(normalized)) {
    const walletRef = findWalletReference(normalized, wallets);
    const newName = text.match(/\b(?:para|como)\s+["“]?([^"”.,;!?]{2,60})["”]?\s*$/i)?.[1]?.trim() ?? null;
    return makeIntent("rename", { walletName: walletRef?.name ?? null, walletKind: walletRef?.kind ?? null, newName });
  }

  const asksForBalance = /\b(?:quanto|qual|mostre|mostrar|consulte|consultar|veja|ver|saldo|patrimonio|tenho|tem)\b/.test(normalized)
    && !/\b(?:gastei|gasto|despesa|relatorio|recebi|ganhei)\b/.test(normalized)
    && (!amount || !/\b(?:defina|definir|ajuste|ajustar|corrija|corrigir|atualize|atualizar|guardei|guarde|guardar|poupei|poupar|separei|separar|reservei|reservar|economizei|economizar|transferi|transferir|transfira|mova|movi|mover|apliquei|aplicar|investi|investir|aportei|aportar|coloquei|colocar|mandei|enviei|retirei|retire|retirar|saquei|saque|sacar|adicionei|adicionar|adicione|acrescentei|acrescentar|depositei|depositar)\b/.test(normalized));
  if (asksForBalance) {
    const reference = findWalletReference(normalized, wallets);
    return makeIntent("balance", { walletName: reference?.name ?? null, walletKind: reference?.kind ?? inferWalletKind(normalized), amount: null });
  }

  const route = normalized.match(/\b(?:da|do|de)\s+(.+?)\s+(?:para|pra|pro|ao|a|na|no|em)\s+(.+)$/);
  const sourceReference = route ? findWalletReference(route[1], wallets) ?? referenceFromText(route[1]) : null;
  const destinationReference = route ? findWalletReference(route[2], wallets) ?? referenceFromText(route[2]) : null;
  const targetReference = destinationReference ?? findWalletReference(normalized, wallets) ?? referenceFromText(normalized);
  const fields = {
    walletName: targetReference?.name ?? null,
    walletKind: targetReference?.kind ?? inferWalletKind(normalized),
    sourceWalletName: sourceReference?.name ?? null,
    sourceWalletKind: sourceReference?.kind ?? null,
  };

  if (/\b(?:defina|definir|ajuste|ajustar|corrija|corrigir|atualize|atualizar)\b/.test(normalized) && /saldo/.test(normalized)) {
    return makeIntent("set_balance", fields);
  }
  if (/\b(?:guardei|guarde|guardar|poupei|poupe|poupar|separei|separar|reservei|reservar|economizei|economizar|transferi|transferir|transfira|mova|movi|mover|apliquei|aplicar|investi|investir|aportei|aportar|coloquei|colocar|mandei|mandar|enviei|enviar)\b/.test(normalized)) {
    return makeIntent("transfer", fields);
  }
  if (/\b(?:retirei|retire|retirar|saquei|saque|sacar|remova|remover)\b/.test(normalized) && targetReference) {
    return makeIntent("remove_balance", fields);
  }
  if (/\b(?:adicionei|adicionar|adicione|acrescentei|acrescentar|depositei|deposite|depositar|lancei saldo|aumente o saldo)\b/.test(normalized) && targetReference) {
    return makeIntent("add_balance", fields);
  }
  return null;
}

function inferWalletKind(text: string): "checking" | "savings" | "investment" | null {
  if (/conta corrente|conta-corrente|banco principal/.test(text)) return "checking";
  if (/poupanca|guardad|guardei|guarde|guardar|poupei|poupe|poupar|separei|separar|reservei|reservar|economizei|economizar|reserva|emergencia/.test(text)) return "savings";
  if (/investimento|investido|aplicacao|apliquei|aplicar|investi|investir|aportei|aportar|tesouro|cdb|acoes/.test(text)) return "investment";
  return null;
}

function referenceFromText(text: string): { name: string | null; kind: "checking" | "savings" | "investment" | null } | null {
  const kind = inferWalletKind(text);
  if (!kind) return null;
  return { name: null, kind };
}

function findWalletReference(text: string, wallets: WalletReference[]): WalletReference | null {
  const matching = wallets.filter((wallet) => text.includes(wallet.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()));
  if (matching.length) return matching.sort((a, b) => b.name.length - a.name.length)[0];
  const kind = inferWalletKind(text);
  return kind ? wallets.find((wallet) => wallet.kind === kind) ?? null : null;
}

function extractNamedWallet(text: string): string | null {
  const name = text.match(/\b(?:chamada|chamado|nomeada|nomeado|com nome)\s+["“]?([\p{L}0-9][\p{L}0-9 &'’-]{1,50}?)["”]?(?=\s+(?:com\s+saldo|saldo\s+inicial|com\s+R\$|com\s+\d|de\s+R\$)|[,;.!?]|$)/iu)?.[1];
  return name?.trim().replace(/["“”]+$/g, "") ?? null;
}

function defaultWalletName(kind: "checking" | "savings" | "investment") {
  return kind === "checking" ? "Conta corrente" : kind === "savings" ? "Poupança" : "Investimentos";
}

function extractMerchant(text: string): string | null {
  const matches = text.match(/\b(?:no|na|em|para|do|da)\s+([\p{L}0-9][\p{L}0-9 .&'-]{1,45})/iu);
  return matches?.[1]?.replace(/\s+(por|no valor|hoje|ontem).*$/i, "").replace(/[.,;:!?]+$/g, "").trim() || null;
}
