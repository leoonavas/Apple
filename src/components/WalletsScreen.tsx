"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeftRight, ChartNoAxesCombined, Check, Landmark, PiggyBank, Plus, WalletCards } from "lucide-react";
import { moneyMarkdown } from "@/lib/finance/money";

type WalletKind = "checking" | "savings" | "investment";
type Wallet = { id: string; name: string; kind: WalletKind; openingBalanceCents: number; balanceCents: number; isDefault: boolean };
type WalletDraft = { id: string | null; name: string; kind: WalletKind; openingBalance: string };
type TransferDraft = { fromWalletId: string; toWalletId: string; amount: string; description: string };

const sections: Array<{ kind: WalletKind; title: string; description: string }> = [
  { kind: "checking", title: "Contas correntes", description: "Entradas e saídas registradas no chat" },
  { kind: "savings", title: "Poupança", description: "Dinheiro separado para guardar" },
  { kind: "investment", title: "Investimentos", description: "Valores que você destinou a investimentos" },
];
const kindLabels: Record<WalletKind, string> = { checking: "Conta corrente", savings: "Poupança", investment: "Investimento" };
const kindIcons = { checking: Landmark, savings: PiggyBank, investment: ChartNoAxesCombined };
const formatMoney = moneyMarkdown;
const inputMoney = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

export function WalletsScreen() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [walletDraft, setWalletDraft] = useState<WalletDraft | null>(null);
  const [transferDraft, setTransferDraft] = useState<TransferDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/wallets", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não consegui carregar as carteiras.");
      setWallets(body.wallets ?? []);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "Não consegui carregar as carteiras.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => wallets.reduce((value, wallet) => {
    if (wallet.kind === "checking") value.checking += wallet.balanceCents;
    else value.saved += wallet.balanceCents;
    return value;
  }, { checking: 0, saved: 0 }), [wallets]);

  function createWallet() {
    setError("");
    setWalletDraft({ id: null, name: "", kind: "savings", openingBalance: "0,00" });
    setTransferDraft(null);
  }

  function editWallet(wallet: Wallet) {
    setError("");
    setWalletDraft({ id: wallet.id, name: wallet.name, kind: wallet.kind, openingBalance: inputMoney(wallet.openingBalanceCents) });
    setTransferDraft(null);
  }

  function startTransfer() {
    const source = wallets.find((wallet) => wallet.isDefault) ?? wallets[0];
    const destination = wallets.find((wallet) => wallet.id !== source?.id);
    if (!source || !destination) return;
    setError("");
    setWalletDraft(null);
    setTransferDraft({ fromWalletId: source.id, toWalletId: destination.id, amount: "", description: "Transferência entre carteiras" });
  }

  async function saveWallet(event: FormEvent) {
    event.preventDefault();
    if (!walletDraft) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(walletDraft.id ? `/api/wallets/${walletDraft.id}` : "/api/wallets", {
        method: walletDraft.id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: walletDraft.name, kind: walletDraft.kind, openingBalance: walletDraft.openingBalance }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(body.error ?? "Não consegui salvar a carteira."); return; }
      setWalletDraft(null);
      await load();
    } catch {
      setError("Não consegui conectar ao app. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  async function transfer(event: FormEvent) {
    event.preventDefault();
    if (!transferDraft) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/wallets/transfers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(transferDraft),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(body.error ?? "Não consegui concluir a transferência."); return; }
      setTransferDraft(null);
      await load();
    } catch {
      setError("Não consegui conectar ao app. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  function updateWalletDraft<K extends keyof WalletDraft>(key: K, value: WalletDraft[K]) {
    setWalletDraft((current) => current ? { ...current, [key]: value } : current);
  }

  function updateTransferDraft<K extends keyof TransferDraft>(key: K, value: TransferDraft[K]) {
    setTransferDraft((current) => current ? { ...current, [key]: value } : current);
  }

  return <section className="page-section wallets-page">
    <div className="page-heading wallet-heading">
      <div><p className="eyebrow">SALDOS POR CONTA</p><h1>Carteiras</h1><p className="page-description">Conta corrente, poupança e investimentos em um só lugar.</p></div>
      <div className="wallet-heading-actions">
        {wallets.length > 1 && <button className="secondary-button" type="button" onClick={startTransfer}><ArrowLeftRight size={15} /> Transferir</button>}
        <button className="round-action" type="button" aria-label="Criar carteira" onClick={createWallet}><Plus size={19} /></button>
      </div>
    </div>

    <div className="wallet-overview">
      <article className="wallet-overview-card saved"><span>Guardado e investido</span><strong>{formatMoney(totals.saved)}</strong><small>Saldo atual em poupança e investimentos</small></article>
      <article className="wallet-overview-card"><span>Conta corrente</span><strong>{formatMoney(totals.checking)}</strong><small>Saldo calculado pelas movimentações</small></article>
    </div>

    {walletDraft && <form className="transaction-card wallet-form" onSubmit={(event) => void saveWallet(event)}>
      <div className="edit-card-top"><strong>{walletDraft.id ? "Editar carteira" : "Nova carteira"}</strong><span className="soft-label"><WalletCards size={14} /> {walletDraft.id ? kindLabels[walletDraft.kind] : "Nova conta"}</span></div>
      {!walletDraft.id && <label className="form-field wallet-kind-field">Tipo de carteira<select value={walletDraft.kind} onChange={(event) => updateWalletDraft("kind", event.target.value as WalletKind)}><option value="checking">Conta corrente</option><option value="savings">Poupança</option><option value="investment">Investimento</option></select></label>}
      <div className="form-grid wallet-form-grid">
        <label className="form-field span-2">Nome<input required minLength={2} maxLength={60} placeholder={walletDraft.kind === "savings" ? "Ex.: Reserva de emergência" : walletDraft.kind === "investment" ? "Ex.: Tesouro Direto" : "Ex.: Banco principal"} value={walletDraft.name} onChange={(event) => updateWalletDraft("name", event.target.value)} /></label>
        <label className="form-field span-2">Saldo de abertura<input required inputMode="decimal" placeholder="0,00" value={walletDraft.openingBalance} onChange={(event) => updateWalletDraft("openingBalance", event.target.value)} /></label>
      </div>
      <p className="helper-note">Informe quanto já havia nessa carteira antes dos lançamentos e transferências registrados no app.</p>
      {error && <p className="field-error">{error}</p>}
      <div className="wallet-form-actions"><button className="secondary-button" type="button" onClick={() => { setWalletDraft(null); setError(""); }}>Cancelar</button><button className="primary-button" type="submit" disabled={busy}><Check size={15} /> {busy ? "Salvando…" : "Salvar carteira"}</button></div>
    </form>}

    {transferDraft && <form className="transaction-card wallet-form" onSubmit={(event) => void transfer(event)}>
      <div className="edit-card-top"><strong>Transferir entre carteiras</strong><span className="soft-label"><ArrowLeftRight size={14} /> Sem alterar relatórios</span></div>
      <div className="form-grid wallet-form-grid">
        <label className="form-field span-2">De<select required value={transferDraft.fromWalletId} onChange={(event) => {
          const fromWalletId = event.target.value;
          setTransferDraft((current) => current ? {
            ...current,
            fromWalletId,
            toWalletId: current.toWalletId === fromWalletId ? wallets.find((wallet) => wallet.id !== fromWalletId)?.id ?? "" : current.toWalletId,
          } : current);
        }}>{wallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name} · {formatMoney(wallet.balanceCents)}</option>)}</select></label>
        <label className="form-field span-2">Para<select required value={transferDraft.toWalletId} onChange={(event) => updateTransferDraft("toWalletId", event.target.value)}>{wallets.filter((wallet) => wallet.id !== transferDraft.fromWalletId).map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}</select></label>
        <label className="form-field">Valor<input required inputMode="decimal" placeholder="0,00" value={transferDraft.amount} onChange={(event) => updateTransferDraft("amount", event.target.value)} /></label>
        <label className="form-field">Descrição<input maxLength={100} value={transferDraft.description} onChange={(event) => updateTransferDraft("description", event.target.value)} /></label>
      </div>
      <p className="helper-note">A transferência reduz o saldo de origem e aumenta o saldo de destino. Ela não vira entrada nem despesa.</p>
      {error && <p className="field-error">{error}</p>}
      <div className="wallet-form-actions"><button className="secondary-button" type="button" onClick={() => { setTransferDraft(null); setError(""); }}>Cancelar</button><button className="primary-button" type="submit" disabled={busy}><ArrowLeftRight size={15} /> {busy ? "Transferindo…" : "Confirmar transferência"}</button></div>
    </form>}

    {loading ? <div className="empty-state compact">Carregando carteiras…</div> : loadError ? <div className="inline-error static" role="alert">{loadError}<button type="button" onClick={() => void load()}>Tentar novamente</button></div> : <div className="wallet-sections">
      {sections.map((section) => {
        const rows = wallets.filter((wallet) => wallet.kind === section.kind);
        const Icon = kindIcons[section.kind];
        const totalCents = rows.reduce((total, wallet) => total + wallet.balanceCents, 0);
        return <section className="wallet-group" key={section.kind}>
          <div className="wallet-group-heading"><div><h2>{section.title}</h2><p>{section.description}</p></div><div className="wallet-group-total"><strong>{formatMoney(totalCents)}</strong><span>{rows.length} {rows.length === 1 ? "carteira" : "carteiras"}</span></div></div>
          {rows.length ? <div className="wallet-list">{rows.map((wallet) => <article className="wallet-card" key={wallet.id}>
            <div className={`wallet-icon ${wallet.kind}`}><Icon size={18} strokeWidth={1.8} /></div>
            <div className="wallet-details"><div className="wallet-title">{wallet.name}{wallet.isDefault && <span className="wallet-default-tag">Principal</span>}</div><div className="wallet-kind-label">{kindLabels[wallet.kind]}</div></div>
            <div className="wallet-balance"><span>Saldo atual</span><strong>{formatMoney(wallet.balanceCents)}</strong></div>
            <button className="wallet-edit-button" type="button" aria-label={`Editar ${wallet.name}`} onClick={() => editWallet(wallet)}>Editar</button>
          </article>)}</div> : <div className="wallet-empty">{section.kind === "checking" ? "Sua conta corrente aparecerá aqui." : `Adicione uma carteira de ${section.kind === "savings" ? "poupança" : "investimento"}.`} <button type="button" onClick={createWallet}>Criar <Plus size={13} /></button></div>}
        </section>;
      })}
    </div>}

    <p className="wallet-footnote">Entradas, saídas e recorrências novas são associadas à conta corrente principal. Transferências entre carteiras alteram os saldos sem entrar nos relatórios de gastos.</p>
  </section>;
}
