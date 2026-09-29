import type { AssistantIntent } from "./schema";
import { extractAmountText, extractExplicitMoneyAmounts } from "@/lib/finance/amount-text";
import { localDate } from "@/lib/finance/dates";

type WalletReference = { name: string; kind: "checking" | "savings" | "investment" };
type WalletKind = WalletReference["kind"];
type WalletActionFields = Omit<NonNullable<AssistantIntent["wallet"]>, "action">;

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(?:poupansa|pupanca|poupaca)\b/g, "poupanca")
    .replace(/\bcartera\b/g, "carteira")
    .replace(/\b(?:gasti|gastey|gstei)\b/g, "gastei")
    .replace(/\bgastie\b/g, "gastei")
    .replace(/\b(?:pguei|paguey|pagie)\b/g, "paguei")
    .replace(/\b(?:recebiu|resebi)\b/g, "recebi")
    .replace(/\b(?:hj|oje)\b/g, "hoje")
    .replace(/\b(?:qto|qnto)\b/g, "quanto");
}

export function fallbackIntent(text: string, categories: string[], wallets: WalletReference[] = []): AssistantIntent {
  const normalized = normalize(text);
  const amount = extractAmountText(text);
  const matchedCategories = categories.filter((category) => normalized.includes(normalize(category)));
  const inferredCategories = inferCategories(normalized).filter((category) => categories.includes(category));
  const selectedCategories = matchedCategories.length ? matchedCategories : inferredCategories;

  if (requiresSafeClarification(text)) {
    return { intent: "clarification", transactions: [], recurrence: null, report: null, adviceTopic: null, clarification: "A mensagem contém uma negação, hipótese ou correção. Qual é a ação final que você quer registrar?" };
  }
  if (hasMultipleFinancialAmounts(text)) {
    return { intent: "clarification", transactions: [], recurrence: null, report: null, adviceTopic: null, clarification: "Encontrei mais de um valor ou movimentação. Envie cada ação em uma mensagem para eu registrar os saldos e lançamentos corretamente." };
  }

  if (isAdviceRequest(normalized)) return adviceIntent(normalized);
  const wallet = detectWalletAction(text, normalized, amount, wallets);
  if (wallet) return wallet;

  if (isReportRequest(normalized)) {
    const pastDate = pastRelativeDate(normalized);
    const period = pastDate ? "custom" : /\b(?:hoje|diari[oa])\b/.test(normalized) ? "today"
      : /\bsemana\b/.test(normalized) ? "week"
      : /\b(?:mes|mensal|mensalmente)\b/.test(normalized) ? "month" : "all";
    return { intent: "report", transactions: [], recurrence: null, report: { period, start: pastDate, end: pastDate, categories: selectedCategories, groupBy: selectedCategories.length ? "category" : period === "all" ? "month" : "day" }, adviceTopic: null, clarification: null };
  }

  const direction = transactionDirection(normalized);
  const frequency = recurrenceFrequency(normalized);
  if (frequency) {
    if (!amount || !direction) return { intent: "clarification", transactions: [], recurrence: null, report: null, adviceTopic: null, clarification: "Qual o valor e essa recorrência é uma entrada ou saída?" };
    return { intent: "recurrence", transactions: [], recurrence: { name: direction === "income" ? "Entrada recorrente" : "Gasto recorrente", direction, amount, merchant: extractMerchant(text), description: text.trim().slice(0, 120), frequency, startOn: frequency === "monthly" ? nextMonthlyDate(normalized) : null, endOn: null, categories: selectedCategories }, report: null, adviceTopic: null, clarification: null };
  }

  if (!amount) {
    return direction
      ? { intent: "clarification", transactions: [], recurrence: null, report: null, adviceTopic: null, clarification: "Qual foi o valor da entrada ou saída?" }
      : { intent: "unsupported", transactions: [], recurrence: null, report: null, adviceTopic: null, clarification: null };
  }
  return { intent: "transaction", transactions: [{ direction, amount, occurredOn: pastRelativeDate(normalized), merchant: extractMerchant(text), description: text.trim().slice(0, 120), categories: selectedCategories, confidence: direction ? 0.72 : 0.35, evidence: text.trim().slice(0, 240) }], recurrence: null, report: null, adviceTopic: null, clarification: null };
}

function pastRelativeDate(text: string): string | null {
  const days = /\banteontem\b/.test(text) ? 2 : /\bontem\b/.test(text) ? 1 : 0;
  if (!days) return null;
  const date = new Date(`${localDate()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function nextMonthlyDate(text: string): string | null {
  const day = Number(text.match(/\b(?:todo dia|dia)\s+(\d{1,2})\b/)?.[1]);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const today = localDate();
  const [year, month] = today.split("-").map(Number);
  for (let offset = 0; offset < 13; offset++) {
    const date = new Date(Date.UTC(year, month - 1 + offset, day));
    if (date.getUTCDate() !== day) continue;
    const candidate = date.toISOString().slice(0, 10);
    if (candidate >= today) return candidate;
  }
  return null;
}

export function requiresSafeClarification(text: string): boolean {
  const normalized = normalize(text);
  return /\bnao\s+(?:registre|registra|anote|anota|lance|salve|grave|crie|transfira|gastei|paguei|recebi|guardei)\b/.test(normalized)
    || /\b(?:quer dizer|na verdade|corrigindo|ops|e se eu|se eu)\b/.test(normalized);
}

function inferCategories(text: string): string[] {
  const found: string[] = [];
  if (/mercadolivre|mercado livre|amazon|shopee|aliexpress|compras? on.?line/.test(text)) found.push("Compras Online");
  if (/\b(?:camiseta|roupa|sapato|calca|vestido)\b/.test(text)) found.push("Vestuário");
  if (/\bmercado\b(?!\s+livre)|mercadinho|supermercado|restaurante|almoco|jantar|lanche|padaria|ifood|comida|feira/.test(text)) found.push("Alimentação");
  if (/\b(?:farmacia|drogaria|medico|consulta medica|remedio|hospital)\b/.test(text)) found.push("Saúde");
  if (/uber|\b99\b|taxi|combustivel|gasolina|onibus|metro|transporte/.test(text)) found.push("Transporte");
  if (/aluguel|condominio|luz|energia|agua|internet|moradia/.test(text)) found.push("Moradia");
  if (/netflix|spotify|assinatura/.test(text)) found.push("Assinaturas");
  return found;
}

export function hasMultipleFinancialAmounts(text: string): boolean {
  if (extractExplicitMoneyAmounts(text).length > 1) return true;
  if (/\b\d+(?:[,.]\d{1,2})?\s+e\s+\d+(?:[,.]\d{1,2})?\b/i.test(text)) return true;
  const parts = text.split(/\s+(?:e\s+depois|e\s+em\s+seguida|depois|e)(?=\s+(?:eu\s+)?(?:gastei|gasti|paguei|comprei|recebi|ganhei|guardei|guarda|transferi|investi|adicionei|retirei|saquei))\s+/i);
  return parts.filter((part) => extractAmountText(part) !== null).length > 1;
}

function isAdviceRequest(text: string): boolean {
  return /\b(?:dicas?|sugestao|sugestoes|orientacao|conselho|aconselhamento|faz sentido|vale a pena|gastar menos|cortar gastos|reduzir (?:gastos|despesas)|onde (?:posso )?(?:economizar|reduzir|cortar)|plano de orcamento)\b/.test(text)
    || /\bcomo\b.*\b(?:controlar|organizar|economizar|investir|cortar|reduzir)\b/.test(text)
    || /\b(?:ajuda|ajude)\b.*\b(?:organizar|controlar|economizar|nao estourar)\b/.test(text);
}

function adviceIntent(text: string): AssistantIntent {
  const adviceTopic = /invest/.test(text) ? "investing" : /cort|reduz|economiz|gastar menos/.test(text) ? "cut-spending" : /salario/.test(text) ? "salary" : "budget";
  return { intent: "advice", transactions: [], recurrence: null, report: null, adviceTopic, clarification: null };
}

function isReportRequest(text: string): boolean {
  return /\b(?:relatorio|resumo|extrato)\b/.test(text)
    || /\bquanto\b.*\b(?:gastei|gasto|saiu|recebi|ganhei|entrou|despesas?|gastos?)\b/.test(text)
    || /\b(?:mostra|mostrar|mostre|veja|ver|qual|total)\b.*\b(?:gastos?|despesas?|saidas?|entradas?|receitas?)\b/.test(text)
    || /\bquanto deu\b.*\b(?:de|em|com)\b/.test(text);
}

function recurrenceFrequency(text: string): "weekly" | "monthly" | "yearly" | null {
  if (/\b(?:toda semana|todo semana|semanal|semanalmente)\b/.test(text)) return "weekly";
  if (/\b(?:todo ano|toda ano|anual|anualmente)\b/.test(text)) return "yearly";
  if (/\b(?:todo mes|toda mes|mensal|mensalmente|todo dia\s+\d{1,2}|assinatura)\b/.test(text)) return "monthly";
  return null;
}

function transactionDirection(text: string): "income" | "expense" | null {
  if (/\b(?:recebi|ganhei|entrou|caiu|cai|pingou|vendi|renda|salario|depositaram)\b|pix recebido/.test(text)) return "income";
  if (/\b(?:gastei|paguei|pago|comprei|saiu|desembolsei|torrei|cobram|cobranca|assinatura)\b|pix enviado|\bforam\b.*\b(?:no|na|pro|para)\b|\bfoi\b.*\b(?:no|na|pro|para)\b|\bmandei pix\b|\bpassei\b.*\bcartao\b/.test(text)) return "expense";
  return null;
}

function detectWalletAction(text: string, normalized: string, amount: string | null, wallets: WalletReference[]): AssistantIntent | null {
  const knownWallet = wallets.some((wallet) => normalized.includes(normalize(wallet.name)));
  const walletWords = /\b(?:carteira|conta corrente|poupanca|caixinha|cofrinho|investimentos?|investido|guardado|saldo|patrimonio|reserva|tesouro)\b/.test(normalized);
  const moneyMove = /\b(?:guardei|guarda|guarde|guardar|poupei|poupe|poupar|separei|separa|separe|separar|reservei|reservar|economizei|economizar|apliquei|aplicar|investi|investir|aportei|aportar|transferi|transferir|transfira|movi|mova|mover|botei|bota|botar|juntei|juntar)\b/.test(normalized);
  if (!knownWallet && !walletWords && !moneyMove) return null;

  const defaultFields: WalletActionFields = { walletName: null, walletKind: inferWalletKind(normalized), sourceWalletName: null, sourceWalletKind: null, amount, newName: null, description: text.trim().slice(0, 100) };
  const makeIntent = (action: NonNullable<AssistantIntent["wallet"]>["action"], fields: Partial<WalletActionFields> = {}): AssistantIntent => ({
    intent: "wallet", transactions: [], recurrence: null, report: null, adviceTopic: null, clarification: null,
    wallet: { action, ...defaultFields, ...fields },
  });

  if (/\b(?:criei|crie|cria|criar|criado|criada|cadastrei|cadastre|cadastrar|abri|abra|abrir|montei|monte|montar|faca|faz|fiz)\b/.test(normalized) && /\b(?:carteira|conta|poupanca|caixinha|cofrinho|investimento)\b/.test(normalized)) {
    const kind = inferWalletKind(normalized);
    return makeIntent("create", { walletKind: kind, walletName: extractNamedWallet(text) ?? (kind ? defaultWalletName(kind) : null) });
  }
  if (/\b(?:renomeie|renomeia|renomear|mude o nome|muda o nome|altere o nome|troque o nome|troca o nome|agora chama)\b/.test(normalized)) {
    const reference = findWalletReference(normalized, wallets);
    return makeIntent("rename", { walletName: reference?.name ?? null, walletKind: reference?.kind ?? null, newName: extractRenameName(text) });
  }

  const route = normalized.match(/\b(?:da|do|de)\s+(.+?)\s+(?:para|pra|pro|ao|a|na|no|em)\s+(.+)$/);
  const sourceReference = route ? findWalletReference(route[1], wallets) ?? referenceFromText(route[1]) : null;
  const destinationReference = route ? findWalletReference(route[2], wallets) ?? referenceFromText(route[2]) : null;
  const targetReference = destinationReference ?? findWalletReference(normalized, wallets) ?? referenceFromText(normalized);
  const fields: Partial<WalletActionFields> = {
    walletName: targetReference?.name ?? null,
    walletKind: targetReference?.kind ?? inferWalletKind(normalized),
    sourceWalletName: sourceReference?.name ?? null,
    sourceWalletKind: sourceReference?.kind ?? null,
  };

  if (/\b(?:adicionei|adicionar|adicione|adiciona|acrescentei|acrescente|acrescentar|depositei|deposite|depositar|aumenta|aumente|aumentei|somar|some|soma)\b/.test(normalized)
      || /\b(?:coloque|colocar|coloquei)\b/.test(normalized) && /\b(?:de saldo|ao saldo|saldo na|saldo da)\b/.test(normalized)) return makeIntent("add_balance", fields);
  if (/\b(?:retirei|retire|retirar|saquei|saque|sacar|remova|remover|diminua|diminuir|diminui|subtraia|subtrair)\b/.test(normalized)) return makeIntent("remove_balance", fields);
  if (/\b(?:defina|definir|ajuste|ajustar|corrija|corrigir|atualize|atualizar|deixe|deixar)\b/.test(normalized) && /\bsaldo\b/.test(normalized)
      || /\bsaldo\b.*\b(?:e|esta|ficou)\b/.test(normalized) && !!amount
      || /\b(?:deixa|deixe|deixar)\b.*\bcom\b/.test(normalized) && !!amount
      || /\bagora tem\b/.test(normalized) && !!amount) return makeIntent("set_balance", fields);
  if (!amount && /\bquanto\b/.test(normalized) && /\b(?:guardei|poupei|separei|transferi|investi|apliquei)\b/.test(normalized)) {
    return makeIntent("balance", { walletName: fields.walletName, walletKind: fields.walletKind, amount: null });
  }
  if (/\b(?:guardei|guarda|guarde|guardar|poupei|poupe|poupar|separei|separa|separe|separar|reservei|reservar|economizei|economizar|transferi|transferir|transfira|passei|passa|movi|mova|mover|apliquei|aplicar|investi|investir|aportei|aportar|coloquei|coloca|colocar|mandei|mandar|enviei|enviar|botei|bota|botar|juntei|juntar)\b/.test(normalized)) return makeIntent("transfer", fields);

  const balanceQuestion = /\b(?:quanto|saldo|mostra|mostrar|mostre|consulta|consultar|consulte|veja|ver|tenho|tem|guardado|valor)\b/.test(normalized)
    || /\bqual e o valor\b/.test(normalized);
  return balanceQuestion ? makeIntent("balance", { walletName: fields.walletName, walletKind: fields.walletKind, amount: null }) : null;
}

function inferWalletKind(text: string): WalletKind | null {
  if (/\b(?:conta corrente|conta-corrente|banco principal|da conta|do banco)\b/.test(text)) return "checking";
  if (/\b(?:carteira de investimentos?|investimentos?|investido|aplicacao|apliquei|aplicar|investi|investir|aportei|aportar|tesouro|cdb|acoes)\b/.test(text)) return "investment";
  if (/\b(?:poupanca|caixinha|cofrinho|guardado|guardei|guarda|guarde|guardar|poupei|poupe|poupar|separei|separa|separe|separar|reservei|reservar|economizei|economizar|juntei|juntar|reserva|emergencia)\b/.test(text)) return "savings";
  return null;
}

function referenceFromText(text: string): { name: string | null; kind: WalletKind } | null {
  const kind = inferWalletKind(text);
  return kind ? { name: null, kind } : null;
}

function findWalletReference(text: string, wallets: WalletReference[]): WalletReference | null {
  const explicit = wallets.filter((wallet) => text.includes(normalize(wallet.name)));
  if (explicit.length) return explicit.sort((a, b) => b.name.length - a.name.length)[0];
  const kind = inferWalletKind(text);
  if (!kind) return null;
  const sameKind = wallets.filter((wallet) => wallet.kind === kind);
  return sameKind.length === 1 ? sameKind[0] : null;
}

function cleanName(value: string): string | null {
  const stop = /[.!?;,]|\s+com\s+(?=saldo\b|r\$|\d|\b(?:um|uma|dois|duas|tres|quatro|cinco|dez|vinte|cinquenta|cem|cento|duzentos|quinhentos|mil)\b)|\s+(?:saldo\s+(?:inicial|base)|de\s+saldo|por favor|valeu|obrigad[oa]|quando puder|se der|no meu controle|no aplicativo|rapidinho|pra mim|a[ií]|t[aá]|blz|rs)\b/i;
  const name = value.replace(/^[\s"'“”]+/, "").split(stop)[0].trim().replace(/[\s"'“”]+$/g, "");
  return name.length >= 2 && name.length <= 60 ? name : null;
}

function extractNamedWallet(text: string): string | null {
  const tail = text.match(/\b(?:chamada|chamado|nomeada|nomeado|com nome)\s+(.+)/iu)?.[1];
  return tail ? cleanName(tail) : null;
}

function extractRenameName(text: string): string | null {
  const tail = text.match(/\b(?:para|como|agora chama)\s+(.+)$/iu)?.[1];
  return tail ? cleanName(tail) : null;
}

function defaultWalletName(kind: WalletKind) {
  return kind === "checking" ? "Conta corrente" : kind === "savings" ? "Poupança" : "Investimentos";
}

function extractMerchant(text: string): string | null {
  const matches = [...text.matchAll(/\b(?:no|na|em|pro|para|do|da)\s+([\p{L}0-9][\p{L}0-9 .&'-]{1,60})/giu)];
  for (const match of matches) {
    const candidate = match[1].replace(/\s+(?:por|no valor|hoje|ontem|todo|mensalmente|por favor|valeu|obrigad[oa]|pra mim|rapidinho|quando puder|no meu controle|no aplicativo|rs|blz).*$/i, "")
      .replace(/[.,;:!?]+$/g, "").trim();
    if (candidate && !/^(?:app|aplicativo|meu controle)$/i.test(candidate)) return candidate;
  }
  return null;
}
