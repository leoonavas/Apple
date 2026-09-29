import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fallbackIntent } from "../src/lib/ai/fallback";
import { parseNonNegativeMoney, parseTransactionAmount } from "../src/lib/finance/money";

type Intent = ReturnType<typeof fallbackIntent>;
type Expected = {
  intent: Intent["intent"] | "no-action";
  action?: NonNullable<Intent["wallet"]>["action"];
  direction?: "income" | "expense";
  amountCents?: number;
  period?: "today" | "week" | "month" | "all";
  frequency?: "weekly" | "monthly" | "yearly";
  kind?: "checking" | "savings" | "investment";
  walletName?: string;
};
type Case = { text: string; expected: Expected };
type Scenario = { name: string; generate: (random: () => number) => Case };

const countPerScenario = 8_000;
const categories = ["Alimentação", "Moradia", "Transporte", "Saúde", "Educação", "Lazer", "Compras Online", "Vestuário", "Assinaturas", "Salário", "Contas", "Outros"];
const wallets = [
  { name: "Conta corrente", kind: "checking" as const },
  { name: "Reserva", kind: "savings" as const },
  { name: "Tesouro", kind: "investment" as const },
];
const amounts = [
  { text: "R$ 5", cents: 500 }, { text: "5 reais", cents: 500 }, { text: "cinco reais", cents: 500 },
  { text: "R$ 10,50", cents: 1050 }, { text: "dez reais e cinquenta centavos", cents: 1050 },
  { text: "20 conto", cents: 2000 }, { text: "vinte reais", cents: 2000 },
  { text: "R$ 50", cents: 5000 }, { text: "50 reais", cents: 5000 }, { text: "cinquenta reais", cents: 5000 },
  { text: "100 pila", cents: 10000 }, { text: "cem reais", cents: 10000 },
  { text: "R$ 200", cents: 20000 }, { text: "duzentos reais", cents: 20000 },
  { text: "R$ 500", cents: 50000 }, { text: "quinhentos reais", cents: 50000 },
  { text: "mil reais", cents: 100000 }, { text: "R$ 1.200", cents: 120000 },
  { text: "mil e duzentos reais", cents: 120000 }, { text: "2k", cents: 200000 },
  { text: "dois mil reais", cents: 200000 }, { text: "R$ 5.000,00", cents: 500000 },
];
const merchants = ["mercado", "Mercado Livre", "Uber", "farmácia", "padaria", "posto", "restaurante", "shopping", "iFood", "loja", "cinema", "pet shop"];
const senders = ["cliente", "patrão", "João", "empresa", "freela", "meu pai", "Maria", "venda", "trabalho"];
const periods = [
  { text: "hoje", value: "today" as const },
  { text: "essa semana", value: "week" as const },
  { text: "neste mês", value: "month" as const },
  { text: "no geral", value: "all" as const },
];
const walletNames = ["Reserva de Emergência", "Viagem", "Férias", "Casa", "Fundo do Carro", "Faculdade", "Meta 2027", "Reforma"];
const prefixes = ["", "olha, ", "anota aí: ", "por favor, ", "mano, ", "bom dia, ", "ó, ", "seguinte: ", "preciso que você registre: ", "ei, ", "consegue fazer isso? ", "no app: ", "fala, ", "ei app, ", "ajuda aqui: ", "rapidinho: ", "tenho uma coisa: ", "pra minha conta: ", "deixa anotado: ", "posso pedir? "];
const suffixes = ["", ".", "!", ", por favor", ", valeu", " pra mim", " aí", " rapidinho", " rs", " 👍", " tá?", " blz?", " por gentileza", " quando puder", " obrigado", " obrigada", " beleza?", " no meu controle", " no aplicativo", " se der"];

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 0x100000000);
}
function pick<T>(random: () => number, options: readonly T[]): T { return options[Math.floor(random() * options.length)]; }
function sentence(random: () => number, core: string): string {
  const persona = Math.floor(random() * 8);
  let result = `${pick(random, prefixes)}${core}${pick(random, suffixes)}`;
  if (persona === 1) result = result.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (persona === 2) result = result.toUpperCase();
  if (persona === 3) result = result.toLowerCase().replace(/(?<!\d)[.,!?]|[.,!?](?!\d)/g, "");
  if (persona === 4) result = result.replace(/\bvoc[eê]\b/gi, "vc").replace(/\bpara\b/gi, "pra");
  if (persona === 5) result = result.replace(/\bpoupança\b/gi, "poupansa").replace(/\bcarteira\b/gi, "cartera");
  if (persona === 6) result = result.replace(/\bgastei\b/gi, "gasti").replace(/\brecebi\b/gi, "recebi msm");
  return result.replace(/\s+/g, " ").trim();
}
function money(random: () => number) { return pick(random, amounts); }
function make(random: () => number, core: string, expected: Expected): Case { return { text: sentence(random, core), expected }; }

const scenarios: Scenario[] = [
  { name: "despesa", generate: (r) => {
    const amount = money(r), merchant = pick(r, merchants);
    const core = pick(r, [`Gastei ${amount.text} no ${merchant}`, `Paguei ${amount.text} no ${merchant}`, `Comprei no ${merchant} por ${amount.text}`, `Foram ${amount.text} no ${merchant}`, `Saiu ${amount.text} pro ${merchant}`, `Desembolsei ${amount.text} no ${merchant}`]);
    return make(r, core, { intent: "transaction", direction: "expense", amountCents: amount.cents });
  } },
  { name: "entrada", generate: (r) => {
    const amount = money(r), sender = pick(r, senders);
    const core = pick(r, [`Recebi ${amount.text} do ${sender}`, `Ganhei ${amount.text} com ${sender}`, `Entrou ${amount.text} de ${sender}`, `Caiu ${amount.text} do ${sender}`, `Pingou ${amount.text} do ${sender}`, `Pix recebido do ${sender}: ${amount.text}`]);
    return make(r, core, { intent: "transaction", direction: "income", amountCents: amount.cents });
  } },
  { name: "recorrencia_saida", generate: (r) => {
    const amount = money(r), merchant = pick(r, ["Netflix", "academia", "internet", "aluguel", "Spotify", "condomínio", "escola"]);
    const core = pick(r, [`Todo mês pago ${amount.text} de ${merchant}`, `Pago ${amount.text} de ${merchant} todo mês`, `Assinatura mensal de ${merchant}: ${amount.text}`, `Todo dia 5 pago ${amount.text} de ${merchant}`, `Cobram ${amount.text} de ${merchant} mensalmente`]);
    return make(r, core, { intent: "recurrence", direction: "expense", amountCents: amount.cents, frequency: "monthly" });
  } },
  { name: "recorrencia_entrada", generate: (r) => {
    const amount = money(r);
    const core = pick(r, [`Recebo ${amount.text} de salário todo mês`, `Meu salário de ${amount.text} cai todo mês`, `Cai ${amount.text} de salário mensalmente`, `Todo dia 5 recebo ${amount.text} de salário`, `Renda fixa mensal de ${amount.text}`]);
    return make(r, core, { intent: "recurrence", direction: "income", amountCents: amount.cents, frequency: "monthly" });
  } },
  { name: "relatorio", generate: (r) => {
    const period = pick(r, periods);
    const core = pick(r, [`Quanto gastei ${period.text}?`, `Me mostra os gastos ${period.text}`, `Resumo dos gastos ${period.text}`, `Qual o total de despesas ${period.text}?`, `Relatório de gastos ${period.text}`, `Quanto saiu ${period.text}?`]);
    return make(r, core, { intent: "report", period: period.value });
  } },
  { name: "criar_carteira", generate: (r) => {
    const amount = money(r), name = pick(r, walletNames);
    const kind = pick(r, [{ noun: "poupança", value: "savings" as const }, { noun: "carteira de investimentos", value: "investment" as const }]);
    const core = pick(r, [`Crie uma ${kind.noun} chamada ${name} com saldo inicial de ${amount.text}`, `Criei uma ${kind.noun} chamada ${name}. Saldo base: ${amount.text}`, `Abra uma ${kind.noun} chamada ${name} com ${amount.text} de saldo`, `Faça uma ${kind.noun} chamada ${name} com ${amount.text} de saldo`]);
    return make(r, core, { intent: "wallet", action: "create", kind: kind.value, walletName: name, amountCents: amount.cents });
  } },
  { name: "guardar_dinheiro", generate: (r) => {
    const amount = money(r);
    const core = pick(r, [`Guardei ${amount.text} na poupança`, `Guarda ${amount.text} na Reserva`, `Separei ${amount.text} pra Reserva`, `Passei ${amount.text} da conta corrente para Reserva`, `Mandei ${amount.text} da conta corrente pra poupança`, `Botei ${amount.text} na reserva`]);
    return make(r, core, { intent: "wallet", action: "transfer", kind: "savings", amountCents: amount.cents });
  } },
  { name: "adicionar_saldo", generate: (r) => {
    const amount = money(r);
    const core = pick(r, [`Adicione ${amount.text} ao saldo da Reserva`, `Adicionei ${amount.text} na carteira Reserva`, `Aumenta o saldo da Reserva em ${amount.text}`, `Coloque ${amount.text} de saldo na Reserva`, `Deposite ${amount.text} de saldo na Reserva`]);
    return make(r, core, { intent: "wallet", action: "add_balance", kind: "savings", amountCents: amount.cents });
  } },
  { name: "retirar_saldo", generate: (r) => {
    const amount = money(r);
    const core = pick(r, [`Retire ${amount.text} da Reserva`, `Retirei ${amount.text} da poupança`, `Diminua o saldo da Reserva em ${amount.text}`, `Subtraia ${amount.text} da Reserva`, `Saquei ${amount.text} da poupança`]);
    return make(r, core, { intent: "wallet", action: "remove_balance", kind: "savings", amountCents: amount.cents });
  } },
  { name: "definir_saldo", generate: (r) => {
    const amount = money(r);
    const core = pick(r, [`Ajuste o saldo da Reserva para ${amount.text}`, `Defina o saldo da Reserva em ${amount.text}`, `Corrija o saldo da Reserva para ${amount.text}`, `O saldo da Reserva é ${amount.text}`, `Deixe a Reserva com ${amount.text} de saldo`]);
    return make(r, core, { intent: "wallet", action: "set_balance", kind: "savings", amountCents: amount.cents });
  } },
  { name: "consultar_saldo", generate: (r) => {
    const core = pick(r, ["Quanto tenho na Reserva?", "Qual o saldo da poupança?", "Me diz quanto tem na Reserva", "Mostra meu saldo na poupança", "Quanto há guardado na Reserva?", "Me mostra a carteira Reserva", "Quanto tem guardado na poupança?", "Consulta o saldo da Reserva", "Qual é o valor da Reserva?", "Mostra quanto tenho guardado", "Quanto dinheiro tenho na Reserva?", "Quero ver o saldo da minha poupança"]);
    return make(r, core, { intent: "wallet", action: "balance", kind: "savings" });
  } },
  { name: "renomear_carteira", generate: (r) => {
    const name = pick(r, ["Viagem", "Emergência", "Futuro", "Minha Reserva", "Carro", "Casa", "Faculdade", "Férias"]);
    const core = pick(r, [`Renomeie a carteira Reserva para ${name}`, `Mude o nome da Reserva para ${name}`, `Troque o nome da poupança para ${name}`, `A carteira Reserva agora chama ${name}`]);
    return make(r, core, { intent: "wallet", action: "rename", kind: "savings", walletName: "Reserva" });
  } },
  { name: "orientacao", generate: (r) => {
    const core = pick(r, ["Me dá uma sugestão de orçamento", "Como controlar meu salário?", "Como cortar gastos?", "Me dá dicas de investimento", "Onde posso economizar?", "O que fazer para gastar menos?", "Me ajuda a organizar meu salário", "Quero dicas para economizar", "Qual investimento faz sentido?", "Onde reduzir minhas despesas?", "Preciso de um plano de orçamento", "Dá uma orientação financeira"]);
    return make(r, core, { intent: "advice" });
  } },
  { name: "ambiguidade", generate: (r) => {
    const amount = money(r);
    const core = pick(r, [`Anota ${amount.text}`, `Lança ${amount.text}`, `Teve ${amount.text} hoje`, `Registra ${amount.text} aí`]);
    return make(r, core, { intent: "no-action" });
  } },
];

function evaluate(result: Intent, expected: Expected): string | null {
  if (expected.intent === "no-action") {
    if (result.intent === "wallet" || result.intent === "recurrence") return "ação inventada";
    if (result.intent === "transaction" && result.transactions.some((item) => item.direction && item.confidence >= 0.55)) return "direção inventada";
    return null;
  }
  if (result.intent !== expected.intent) return `intenção: ${result.intent}`;
  if (expected.intent === "wallet") {
    if (result.wallet?.action !== expected.action) return `ação da carteira: ${result.wallet?.action ?? "ausente"}`;
    if (expected.kind && result.wallet?.walletKind !== expected.kind) return `tipo da carteira: ${result.wallet?.walletKind ?? "ausente"}`;
    const comparableName = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (expected.walletName && (!result.wallet?.walletName || comparableName(result.wallet.walletName) !== comparableName(expected.walletName))) return `nome da carteira: ${result.wallet?.walletName ?? "ausente"}`;
  }
  if (expected.intent === "transaction" && result.transactions[0]?.direction !== expected.direction) return `direção: ${result.transactions[0]?.direction ?? "ausente"}`;
  if (expected.intent === "recurrence") {
    if (result.recurrence?.direction !== expected.direction) return `direção recorrente: ${result.recurrence?.direction ?? "ausente"}`;
    if (result.recurrence?.frequency !== expected.frequency) return `frequência: ${result.recurrence?.frequency ?? "ausente"}`;
  }
  if (expected.intent === "report" && result.report?.period !== expected.period) return `período: ${result.report?.period ?? "ausente"}`;
  if (expected.amountCents !== undefined) {
    const raw = result.intent === "wallet" ? result.wallet?.amount : result.intent === "recurrence" ? result.recurrence?.amount : result.transactions[0]?.amount;
    const actual = raw ? (result.intent === "wallet" && result.wallet?.action === "set_balance" ? parseNonNegativeMoney(raw) : parseTransactionAmount(raw)) : null;
    if (actual !== expected.amountCents) return `valor: ${actual ?? "ausente"}`;
  }
  return null;
}

const tag = process.argv.find((arg) => arg.startsWith("--tag="))?.slice(6) || "latest";
const outputDir = path.resolve(".data/simulations");
fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
const random = seeded(20260929);
const seen = new Set<string>();
const lines: string[] = [];
const report: Record<string, { total: number; passed: number; failures: Record<string, number>; examples: Array<{ text: string; reason: string }> }> = {};
for (const scenario of scenarios) {
  const item = { total: 0, passed: 0, failures: {} as Record<string, number>, examples: [] as Array<{ text: string; reason: string }> };
  report[scenario.name] = item;
  let attempts = 0;
  while (item.total < countPerScenario) {
    if (++attempts > countPerScenario * 100) throw new Error(`Pouca variedade para ${scenario.name}: ${item.total} falas únicas.`);
    const entry = scenario.generate(random);
    if (seen.has(entry.text)) continue;
    seen.add(entry.text);
    const result = fallbackIntent(entry.text, categories, wallets);
    const reason = evaluate(result, entry.expected);
    item.total++;
    if (reason) {
      item.failures[reason] = (item.failures[reason] ?? 0) + 1;
      if (item.examples.length < 24) item.examples.push({ text: entry.text, reason });
    } else item.passed++;
    lines.push(JSON.stringify({ scenario: scenario.name, ...entry, passed: !reason, reason }));
  }
}
const total = Object.values(report).reduce((sum, item) => sum + item.total, 0);
const passed = Object.values(report).reduce((sum, item) => sum + item.passed, 0);
const summary = { seed: 20260929, total, passed, failed: total - passed, accuracy: Number((passed / total * 100).toFixed(2)), scenarios: report };
fs.writeFileSync(path.join(outputDir, `${tag}.jsonl.gz`), gzipSync(Buffer.from(lines.join("\n") + "\n")));
fs.writeFileSync(path.join(outputDir, `${tag}.json`), JSON.stringify(summary, null, 2));
process.stdout.write(JSON.stringify({ tag, total, passed, failed: total - passed, accuracy: summary.accuracy, byScenario: Object.fromEntries(Object.entries(report).map(([name, item]) => [name, { passed: item.passed, total: item.total, failures: Object.entries(item.failures).sort((a, b) => b[1] - a[1]).slice(0, 5) }])) }, null, 2) + "\n");
