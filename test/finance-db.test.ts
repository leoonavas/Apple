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
    service.updateWallet({ id: checking.id, name: checking.name, openingBalanceCents: checking.openingBalanceCents + 100000 });
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
    service.updateWallet({ id: checking.id, name: checking.name, openingBalanceCents: checking.openingBalanceCents });
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
  it("ocorrência de salário não duplica ao recalcular relatórios", () => {
    const today = dates.localDate();
    service.createRecurrence({ name: "Salário", direction: "income", amountCents: 500000, merchant: "Empregador", description: "Salário", frequency: "monthly", startOn: today, endOn: null, categoryIds: [] });
    const first = service.report({ period: "all" });
    const second = service.report({ period: "all" });
    assert.equal(first.incomeCents, 550000);
    assert.equal(second.incomeCents, 550000);
  });
  after(() => {
    database.closeDatabaseForTests();
    fs.rmSync(temporaryDataDir, { recursive: true, force: true });
  });
});
