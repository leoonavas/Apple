import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const temporaryDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "apple-finance-test-"));
process.env.APP_DATA_DIR = temporaryDataDir;

describe("SQLite financeiro", () => {
  let service: typeof import("../src/lib/finance/service");
  let dates: typeof import("../src/lib/finance/dates");
  let database: typeof import("../src/lib/db");
  let processor: typeof import("../src/lib/ai/processor");
  before(async () => {
    [service, dates, database, processor] = await Promise.all([
      import("../src/lib/finance/service"),
      import("../src/lib/finance/dates"),
      import("../src/lib/db"),
      import("../src/lib/ai/processor"),
    ]);
  });
  it("total geral conta uma compra com duas categorias uma vez", () => {
    const messageId = service.addMessage("user", "Comprei camiseta no MercadoLivre por 50 reais");
    const categories = service.getCategories();
    const ids = ["Compras Online", "Vestuário"].map((name) => categories.find((category) => category.name === name)!.id);
    service.createTransaction({ direction: "expense", amountCents: 5000, description: "Camiseta", merchant: "MercadoLivre", occurredOn: dates.localDate(), sourceMessageId: messageId, categoryIds: ids });
    const total = service.report({ period: "all", categoryNames: [], groupBy: "category" });
    const online = service.report({ period: "all", categoryNames: ["Compras Online"], groupBy: "category" });
    assert.equal(total.expenseCents, 5000);
    assert.equal(online.expenseCents, 5000);
    assert.equal(online.merchantRows[0].name, "MercadoLivre");
    assert.equal(online.merchantRows[0].cents, 5000);
  });
  it("rejeita valores acima do limite antes de gravar no SQLite", () => {
    const before = service.report({ period: "all" });
    assert.throws(() => service.createTransaction({
      direction: "expense",
      amountCents: 179070809312900,
      description: "Áudio",
      merchant: "gravacao-1790708093129.wav",
      occurredOn: dates.localDate(),
      sourceMessageId: null,
      categoryIds: [],
    }), /valor precisa estar entre/);
    const after = service.report({ period: "all" });
    assert.equal(after.count, before.count);
    assert.equal(after.expenseCents, before.expenseCents);
  });
  it("mantém contas correntes, poupança e investimentos e não conta transferências como renda ou gasto", () => {
    const messageId = service.addMessage("user", "Recebi salário de 500 reais");
    service.createTransaction({ direction: "income", amountCents: 50000, description: "Salário", merchant: "Empregador", occurredOn: dates.localDate(), sourceMessageId: messageId, categoryIds: [] });
    const checking = service.listWallets().find((wallet) => wallet.isDefault)!;
    const savingsId = service.createWallet({ name: "Reserva", kind: "savings", openingBalanceCents: 15000 });
    const investmentId = service.createWallet({ name: "Tesouro", kind: "investment", openingBalanceCents: 25000 });
    const before = service.report({ period: "all" });

    service.transferWalletFunds({ fromWalletId: checking.id, toWalletId: savingsId, amountCents: 10000, description: "Guardar parte do salário" });

    const wallets = service.listWallets();
    assert.equal(wallets.find((wallet) => wallet.id === checking.id)?.balanceCents, checking.balanceCents - 10000);
    assert.equal(wallets.find((wallet) => wallet.id === savingsId)?.balanceCents, 25000);
    assert.equal(wallets.find((wallet) => wallet.id === investmentId)?.balanceCents, 25000);
    const after = service.report({ period: "all" });
    assert.equal(after.incomeCents, before.incomeCents);
    assert.equal(after.expenseCents, before.expenseCents);
    assert.equal(after.count, before.count);
    assert.throws(() => service.transferWalletFunds({ fromWalletId: savingsId, toWalletId: checking.id, amountCents: 25001, description: "Acima do saldo" }), /saldo disponível/);
  });
  it("processa 'guardei 500 reais na poupança' como transferência pelo chat", async () => {
    const checking = service.listWallets().find((wallet) => wallet.isDefault)!;
    const messageId = service.addMessage("user", "guardei 500 reais na poupança");
    service.adjustWalletBalance({ walletId: checking.id, direction: "credit", amountCents: 100000, description: "Saldo de teste" });
    const savingsBefore = service.listWallets().find((wallet) => wallet.kind === "savings")!;
    const checkingBefore = service.listWallets().find((wallet) => wallet.id === checking.id)!;
    const reportBefore = service.report({ period: "all" });

    const reply = await processor.processUserMessage(messageId);

    const savingsAfter = service.listWallets().find((wallet) => wallet.id === savingsBefore.id)!;
    const checkingAfter = service.listWallets().find((wallet) => wallet.id === checking.id)!;
    const reportAfter = service.report({ period: "all" });
    assert.match(reply.content, /Transferi \*\*R\$\s+500,00\*\*/);
    assert.equal(savingsAfter.balanceCents, savingsBefore.balanceCents + 50000);
    assert.equal(checkingAfter.balanceCents, checkingBefore.balanceCents - 50000);
    assert.equal(reportAfter.count, reportBefore.count);
    assert.equal(reportAfter.incomeCents, reportBefore.incomeCents);
    assert.equal(reportAfter.expenseCents, reportBefore.expenseCents);
  });
  it("executa criação, ajuste, consulta, retirada, renomeação e saldo final pelo chat", async () => {
    const send = async (content: string) => processor.processUserMessage(service.addMessage("user", content));
    const before = service.report({ period: "all" });

    assert.match((await send("crie uma carteira de investimento chamada Tesouro Direto com saldo inicial de R$ 250")).content, /Criei a carteira/);
    assert.match((await send("adicione 100 reais ao saldo da carteira Tesouro Direto")).content, /Adicionei/);
    assert.match((await send("qual o saldo da carteira Tesouro Direto?")).content, /R\$\s+350,00/);
    assert.match((await send("retire 50 reais da carteira Tesouro Direto")).content, /Retirei/);
    assert.match((await send("renomeie a carteira Tesouro Direto para Reserva Tesouro")).content, /Renomeei/);
    assert.match((await send("ajuste o saldo da carteira Reserva Tesouro para R$ 600")).content, /Atualizei o saldo/);

    const wallet = service.listWallets().find((item) => item.name === "Reserva Tesouro");
    assert.equal(wallet?.balanceCents, 60000);
    const after = service.report({ period: "all" });
    assert.equal(after.count, before.count);
    assert.equal(after.incomeCents, before.incomeCents);
    assert.equal(after.expenseCents, before.expenseCents);
  });
  it("reconhece 'criei uma poupança chamada ... saldo base' como criação com saldo inicial", async () => {
    const before = service.report({ period: "all" });
    const messageId = service.addMessage("user", "criei uma poupança chamada reserva de emergência. Saldo base: 100");
    const reply = await processor.processUserMessage(messageId);

    const wallet = service.listWallets().find((item) => item.name === "reserva de emergência");
    assert.match(reply.content, /Criei a carteira/);
    assert.equal(wallet?.kind, "savings");
    assert.equal(wallet?.balanceCents, 10000);
    const after = service.report({ period: "all" });
    assert.equal(after.count, before.count);
    assert.equal(after.incomeCents, before.incomeCents);
    assert.equal(after.expenseCents, before.expenseCents);
  });
  it("pede a carteira exata quando há duas poupanças e evita aplicar uma mensagem com duas ações", async () => {
    const before = service.listWallets();
    const incomeBefore = service.report({ period: "all" });
    const ambiguous = await processor.processUserMessage(service.addMessage("user", "guardei 50 reais na poupança"));
    assert.match(ambiguous.content, /qual carteira de poupança/);
    assert.deepEqual(service.listWallets().map((wallet) => wallet.balanceCents), before.map((wallet) => wallet.balanceCents));

    const compound = await processor.processUserMessage(service.addMessage("user", "recebi R$ 500 e guardei R$ 100 na Reserva"));
    assert.match(compound.content, /mais de um valor ou movimentação/);
    assert.deepEqual(service.listWallets().map((wallet) => wallet.balanceCents), before.map((wallet) => wallet.balanceCents));
    assert.equal(service.report({ period: "all" }).count, incomeBefore.count);

    const specific = await processor.processUserMessage(service.addMessage("user", "guardei 50 reais na Reserva"));
    assert.match(specific.content, /Transferi/);
    assert.equal(service.listWallets().find((wallet) => wallet.name === "Reserva")?.balanceCents, before.find((wallet) => wallet.name === "Reserva")!.balanceCents + 5000);
  });
  it("lança entradas e saídas na carteira citada sem escolher uma poupança ambígua", async () => {
    const before = service.listWallets();
    const reportBefore = service.report({ period: "all" });
    assert.match((await processor.processUserMessage(service.addMessage("user", "recebi 200 reais na Reserva"))).content, /Entrada/);
    assert.match((await processor.processUserMessage(service.addMessage("user", "paguei 50 reais da Reserva"))).content, /Saída/);
    const after = service.listWallets();
    assert.equal(after.find((wallet) => wallet.name === "Reserva")?.balanceCents, before.find((wallet) => wallet.name === "Reserva")!.balanceCents + 15000);
    assert.equal(after.find((wallet) => wallet.isDefault)?.balanceCents, before.find((wallet) => wallet.isDefault)?.balanceCents);
    assert.equal(service.report({ period: "all" }).count, reportBefore.count + 2);

    const ambiguous = await processor.processUserMessage(service.addMessage("user", "recebi 100 reais na poupança"));
    assert.match(ambiguous.content, /qual carteira de poupança/);
    assert.equal(service.report({ period: "all" }).count, reportBefore.count + 2);
  });
  it("ocorrência de salário não duplica ao recalcular relatórios", () => {
    const today = dates.localDate();
    const before = service.report({ period: "all" });
    service.createRecurrence({ name: "Salário", direction: "income", amountCents: 500000, merchant: "Empregador", description: "Salário", frequency: "monthly", startOn: today, endOn: null, categoryIds: [] });
    const first = service.report({ period: "all" });
    const second = service.report({ period: "all" });
    assert.equal(first.incomeCents, before.incomeCents + 500000);
    assert.equal(second.incomeCents, first.incomeCents);
  });
  it("registra a data correta de ontem e agenda salário para o próximo dia 5 pelo chat", async () => {
    const yesterday = new Date(`${dates.localDate()}T12:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const day = yesterday.toISOString().slice(0, 10);
    const before = service.report({ period: "custom", start: day, end: day });
    const expense = await processor.processUserMessage(service.addMessage("user", "gastei 25 reais ontem na padaria"));
    assert.match(expense.content, /R\$\s+25,00/);
    assert.equal(service.report({ period: "custom", start: day, end: day }).expenseCents, before.expenseCents + 2500);

    const recurring = await processor.processUserMessage(service.addMessage("user", "todo dia 5 recebo 2k de salário"));
    assert.match(recurring.content, /recorrência|recorrente/i);
    const created = service.listRecurrences().find((item) => item.description === "todo dia 5 recebo 2k de salário");
    assert.ok(created);
    assert.equal(String(created.startOn).slice(8), "05");
    assert.ok(String(created.startOn) >= dates.localDate());
  });
  after(() => {
    database.closeDatabaseForTests();
    fs.rmSync(temporaryDataDir, { recursive: true, force: true });
  });
});
