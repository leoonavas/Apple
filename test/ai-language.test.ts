import assert from "node:assert/strict";
import test from "node:test";
import { fallbackIntent } from "../src/lib/ai/fallback";
import { extractAmountText } from "../src/lib/finance/amount-text";
import { parseTransactionAmount } from "../src/lib/finance/money";
import { localDate } from "../src/lib/finance/dates";

const categories = ["Alimentação", "Moradia", "Transporte", "Saúde", "Educação", "Lazer", "Compras Online", "Vestuário", "Assinaturas", "Salário", "Contas", "Outros"];
const wallets = [
  { name: "Conta corrente", kind: "checking" as const },
  { name: "Reserva", kind: "savings" as const },
  { name: "Tesouro", kind: "investment" as const },
];
type Case = { text: string; intent: string; direction?: string; action?: string; cents?: number; period?: string; kind?: string; category?: string; name?: string };

const cases: Case[] = [
  { text: "gstei 35 conto no mercadinho", intent: "transaction", direction: "expense", cents: 3500, category: "Alimentação" },
  { text: "pguei 12,90 no Uber", intent: "transaction", direction: "expense", cents: 1290, category: "Transporte" },
  { text: "passei 80 no cartão na farmácia", intent: "transaction", direction: "expense", cents: 8000, category: "Saúde" },
  { text: "foi 45 no almoço", intent: "transaction", direction: "expense", cents: 4500, category: "Alimentação" },
  { text: "mandei pix de 200 reais pra Maria", intent: "transaction", direction: "expense", cents: 20000 },
  { text: "caiu 2k do trabalho", intent: "transaction", direction: "income", cents: 200000 },
  { text: "me depositaram 300 reais", intent: "transaction", direction: "income", cents: 30000 },
  { text: "vendi bicicleta por 350 reais", intent: "transaction", direction: "income", cents: 35000 },
  { text: "fiz um freela, pingou 750", intent: "transaction", direction: "income", cents: 75000 },
  { text: "gastei dez reais e cinquenta centavos na padaria", intent: "transaction", direction: "expense", cents: 1050, category: "Alimentação" },
  { text: "gastei 10 reais e cinquenta centavos na padaria", intent: "transaction", direction: "expense", cents: 1050, category: "Alimentação" },
  { text: "gastie 30 no mercado", intent: "transaction", direction: "expense", cents: 3000, category: "Alimentação" },
  { text: "paguei 1000,00 de aluguel", intent: "transaction", direction: "expense", cents: 100000, category: "Moradia" },
  { text: "recebi 100 no pix da Maria", intent: "transaction", direction: "income", cents: 10000 },
  { text: "qto gastei hj?", intent: "report", period: "today" },
  { text: "quanto já saiu esse mês?", intent: "report", period: "month" },
  { text: "me fala o total de gasto da semana", intent: "report", period: "week" },
  { text: "quanto gastei na farmácia esse mês?", intent: "report", period: "month", category: "Saúde" },
  { text: "quanto deu de compras online neste mês?", intent: "report", period: "month", category: "Compras Online" },
  { text: "mostra minha despesa de hoje", intent: "report", period: "today" },
  { text: "me mostra minha receita do mês", intent: "report", period: "month" },
  { text: "todo dia 5 recebo 2k de salário", intent: "recurrence", direction: "income", cents: 200000 },
  { text: "minha assinatura de internet é 99 reais por mês", intent: "recurrence", direction: "expense", cents: 9900 },
  { text: "me ajuda a não estourar o salário", intent: "advice" },
  { text: "vale a pena investir com meu salário?", intent: "advice" },
  { text: "quero saber onde cortar despesa", intent: "advice" },
  { text: "cria uma caixinha chamada Viagem com 100 reais", intent: "wallet", action: "create", kind: "savings", cents: 10000, name: "Viagem" },
  { text: "faz um cofrinho chamado Carro com 50 reais", intent: "wallet", action: "create", kind: "savings", cents: 5000, name: "Carro" },
  { text: "guardei 100 conto na caixinha", intent: "wallet", action: "transfer", kind: "savings", cents: 10000 },
  { text: "juntei 20 pila no cofrinho", intent: "wallet", action: "transfer", kind: "savings", cents: 2000 },
  { text: "passei 200 da conta pra caixinha", intent: "wallet", action: "transfer", kind: "savings", cents: 20000 },
  { text: "soma 30 reais no saldo da Reserva", intent: "wallet", action: "add_balance", kind: "savings", cents: 3000 },
  { text: "aumentei em 40 reais o saldo da Reserva", intent: "wallet", action: "add_balance", kind: "savings", cents: 4000 },
  { text: "diminui em 10 reais a Reserva", intent: "wallet", action: "remove_balance", kind: "savings", cents: 1000 },
  { text: "deixa minha Reserva com 300 reais", intent: "wallet", action: "set_balance", kind: "savings", cents: 30000 },
  { text: "a Reserva agora tem 300 reais", intent: "wallet", action: "set_balance", kind: "savings", cents: 30000 },
  { text: "quanto tem na minha caixinha?", intent: "wallet", action: "balance", kind: "savings" },
  { text: "renomeia a Reserva para Viagem", intent: "wallet", action: "rename", kind: "savings", name: "Reserva" },
  { text: "transferi cinquenta reais da Reserva para Tesouro", intent: "wallet", action: "transfer", kind: "investment", cents: 5000 },
  { text: "quero adicionar 30 reais à conta corrente", intent: "wallet", action: "add_balance", kind: "checking", cents: 3000 },
  { text: "criei uma poupança chamada Reserva de Emergência. Saldo base: 100", intent: "wallet", action: "create", kind: "savings", cents: 10000, name: "Reserva de Emergência" },
  { text: "recebi R$ 500 e guardei R$ 100 na poupança", intent: "clarification" },
  { text: "não registre: gastei 50 no mercado", intent: "clarification" },
  { text: "e se eu guardar 100 na poupança?", intent: "clarification" },
  { text: "gastei 50, quer dizer 30", intent: "clarification" },
  { text: "gastei 100 reais e paguei 20 reais", intent: "clarification" },
  { text: "gastei 100 e 200 no mercado", intent: "clarification" },
  { text: "crie uma carteira chamada Meta 2027 com mil e duzentos reais", intent: "wallet", action: "create", cents: 120000, name: "Meta 2027" },
  { text: "todo dia 5 recebo meu salário", intent: "clarification" },
  { text: "anota 50 reais", intent: "transaction" },
];

test("falas independentes de brasileiros com gírias, erros e ambiguidades", () => {
  const failures: string[] = [];
  for (const entry of cases) {
    try {
    const result = fallbackIntent(entry.text, categories, wallets);
    assert.equal(result.intent, entry.intent, entry.text);
    if (entry.action) assert.equal(result.wallet?.action, entry.action, entry.text);
    if (entry.kind) assert.equal(result.wallet?.walletKind, entry.kind, entry.text);
    if (entry.name) assert.equal(result.wallet?.walletName?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(), entry.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(), entry.text);
    if (entry.direction) assert.equal(result.intent === "recurrence" ? result.recurrence?.direction : result.transactions[0]?.direction, entry.direction, entry.text);
    if (entry.period) assert.equal(result.report?.period, entry.period, entry.text);
    if (entry.category) assert.ok(result.intent === "report" ? result.report?.categories.includes(entry.category) : result.transactions[0]?.categories.includes(entry.category), entry.text);
    if (entry.cents !== undefined) {
      const raw = result.intent === "wallet" ? result.wallet?.amount : result.intent === "recurrence" ? result.recurrence?.amount : result.transactions[0]?.amount;
      assert.equal(parseTransactionAmount(raw ?? ""), entry.cents, entry.text);
    }
    } catch (error) {
      failures.push(`${entry.text}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("lê reais por extenso e centavos sem converter datas em valores", () => {
  assert.equal(parseTransactionAmount(extractAmountText("paguei 10 reais e cinquenta centavos") ?? ""), 1050);
  assert.equal(parseTransactionAmount(extractAmountText("todo dia 5 pago R$ 50") ?? ""), 5000);
  assert.equal(extractAmountText("todo dia 5 recebo meu salário"), null);
});

test("interpreta ontem e anteontem como datas, não como valores", () => {
  const daysAgo = (days: number) => {
    const date = new Date(`${localDate()}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
  };
  assert.equal(fallbackIntent("gastei 25 reais ontem", categories, wallets).transactions[0]?.occurredOn, daysAgo(1));
  assert.equal(fallbackIntent("recebi 40 reais anteontem", categories, wallets).transactions[0]?.occurredOn, daysAgo(2));
  assert.deepEqual(fallbackIntent("quanto gastei ontem?", categories, wallets).report?.start, daysAgo(1));
  assert.deepEqual(fallbackIntent("quanto gastei anteontem?", categories, wallets).report?.end, daysAgo(2));
});

test("recorrência no dia 5 começa na próxima ocorrência desse dia", () => {
  const today = localDate();
  const [year, month] = today.split("-").map(Number);
  const thisMonth = `${year}-${String(month).padStart(2, "0")}-05`;
  const nextMonth = new Date(Date.UTC(year, month, 5)).toISOString().slice(0, 10);
  const expected = thisMonth >= today ? thisMonth : nextMonth;
  assert.equal(fallbackIntent("todo dia 5 recebo 2k de salário", categories, wallets).recurrence?.startOn, expected);
});
