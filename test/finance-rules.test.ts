import assert from "node:assert/strict";
import test from "node:test";
import { fallbackIntent } from "../src/lib/ai/fallback";
import { clampMonthlyDay, periodFor } from "../src/lib/finance/dates";
import { normalizeMerchant, parseMoney, parseNonNegativeMoney, parseTransactionAmount } from "../src/lib/finance/money";

const categories = ["Alimentação", "Compras Online", "Vestuário", "Transporte", "Outros"];

test("normaliza valores em reais sem erro de centavos", () => {
  assert.equal(parseMoney("R$ 1.234,56"), 123456);
  assert.equal(parseMoney("50,5"), 5050);
  assert.equal(parseMoney("50.50"), 5050);
  assert.equal(parseMoney("0"), null);
});

test("bloqueia timestamps interpretados como valores financeiros", () => {
  assert.equal(parseTransactionAmount("R$ 20,00"), 2000);
  assert.equal(parseTransactionAmount("1790708093129"), null);
});

test("aceita saldo inicial zero sem aceitar saldo inválido", () => {
  assert.equal(parseNonNegativeMoney("0,00"), 0);
  assert.equal(parseNonNegativeMoney("R$ 250,50"), 25050);
  assert.equal(parseNonNegativeMoney("-20"), null);
});

test("interpreta gasto simples e categoria de mercado", () => {
  const parsed = fallbackIntent("Gastei 50 reais no mercado", categories);
  assert.equal(parsed.intent, "transaction");
  assert.equal(parsed.transactions[0].direction, "expense");
  assert.equal(parseMoney(parsed.transactions[0].amount ?? ""), 5000);
  assert.ok(parsed.transactions[0].categories.includes("Alimentação"));
});

test("classifica marketplace e tipo de produto em duas categorias", () => {
  const parsed = fallbackIntent("Comprei camiseta no MercadoLivre por 50 reais", categories);
  assert.deepEqual(new Set(parsed.transactions[0].categories), new Set(["Compras Online", "Vestuário"]));
  assert.ok(!parsed.transactions[0].categories.includes("Alimentação"));
});

test("interpreta transcrição de gasto em marketplace sem alterar o valor", () => {
  const parsed = fallbackIntent("Gastei 20 reais em Mercado Livre.", categories);
  assert.equal(parsed.intent, "transaction");
  assert.equal(parsed.transactions[0].direction, "expense");
  assert.equal(parseTransactionAmount(parsed.transactions[0].amount ?? ""), 2000);
  assert.equal(parsed.transactions[0].merchant, "Mercado Livre");
  assert.deepEqual(parsed.transactions[0].categories, ["Compras Online"]);
});

test("entende ações de carteira antes de classificar como entrada ou saída", () => {
  const wallets = [
    { name: "Conta corrente", kind: "checking" as const },
    { name: "Reserva", kind: "savings" as const },
  ];
  const saving = fallbackIntent("guardei 500 reais na poupança", categories, wallets);
  assert.equal(saving.intent, "wallet");
  assert.equal(saving.wallet?.action, "transfer");
  assert.equal(saving.wallet?.amount, "500");
  assert.equal(saving.wallet?.walletKind, "savings");
  assert.equal(saving.wallet?.walletName, "Reserva");

  const create = fallbackIntent("crie uma carteira de investimentos chamada Tesouro Direto com saldo inicial de R$ 2.000", categories, wallets);
  assert.equal(create.intent, "wallet");
  assert.equal(create.wallet?.action, "create");
  assert.equal(create.wallet?.walletName, "Tesouro Direto");
  assert.equal(create.wallet?.walletKind, "investment");
  assert.equal(create.wallet?.amount, "2.000");

  const createSavings = fallbackIntent("criei uma poupança chamada reserva de emergência. Saldo base: 100", categories, wallets);
  assert.equal(createSavings.intent, "wallet");
  assert.equal(createSavings.wallet?.action, "create");
  assert.equal(createSavings.wallet?.walletName, "reserva de emergência");
  assert.equal(createSavings.wallet?.walletKind, "savings");
  assert.equal(createSavings.wallet?.amount, "100");

  const balance = fallbackIntent("quanto tenho guardado na poupança?", categories, wallets);
  assert.equal(balance.intent, "wallet");
  assert.equal(balance.wallet?.action, "balance");
  assert.equal(balance.wallet?.walletKind, "savings");
  assert.equal(fallbackIntent("quanto guardei na poupança?", categories, wallets).wallet?.action, "balance");

  const add = fallbackIntent("adicione 100 reais à poupança", categories, wallets);
  assert.equal(add.intent, "wallet");
  assert.equal(add.wallet?.action, "add_balance");

  const transfer = fallbackIntent("mova 100 reais da conta corrente para Reserva", categories, wallets);
  assert.equal(transfer.intent, "wallet");
  assert.equal(transfer.wallet?.action, "transfer");
  assert.equal(transfer.wallet?.sourceWalletName, "Conta corrente");
  assert.equal(transfer.wallet?.walletName, "Reserva");

  const spend = fallbackIntent("Gastei 20 reais em Mercado Livre", categories, wallets);
  assert.equal(spend.intent, "transaction");
  assert.equal(spend.transactions[0].direction, "expense");
});

test("relatório sem período usa todo o histórico", () => {
  const parsed = fallbackIntent("Quanto gastei com Compras Online?", categories);
  assert.equal(parsed.intent, "report");
  assert.equal(parsed.report?.period, "all");
  assert.deepEqual(parsed.report?.categories, ["Compras Online"]);
  assert.equal(periodFor("all").label, "todo o histórico");
});

test("não inventa movimentação sem valor e direção", () => {
  const parsed = fallbackIntent("Paguei uma conta", categories);
  assert.equal(parsed.intent, "clarification");
});

test("recorrência identifica frequência e entrada salarial", () => {
  const parsed = fallbackIntent("Meu salário de R$ 5.000 todo mês", categories);
  assert.equal(parsed.intent, "recurrence");
  assert.equal(parsed.recurrence?.direction, "income");
  assert.equal(parsed.recurrence?.frequency, "monthly");
  assert.equal(parseMoney(parsed.recurrence?.amount ?? ""), 500000);
});

test("normalização de estabelecimento e vencimento mensal no fim do mês", () => {
  assert.equal(normalizeMerchant("MercadoLivre"), "mercadolivre");
  assert.equal(clampMonthlyDay(2026, 1, 31), "2026-02-28");
});
