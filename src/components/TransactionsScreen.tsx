"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { CategoryPicker, type CategoryOption } from "./CategoryPicker";
import type { TransactionView } from "@/lib/finance/types";

const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export function TransactionsScreen() {
  const [transactions, setTransactions] = useState<TransactionView[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    const [txResponse, categoryResponse] = await Promise.all([fetch("/api/transactions", { cache: "no-store" }), fetch("/api/categories", { cache: "no-store" })]);
    const txData = await txResponse.json(); const catData = await categoryResponse.json();
    setTransactions(txData.transactions ?? []); setCategories(catData.categories ?? []); setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function remove(id: string) {
    if (!window.confirm("Excluir esta movimentação?")) return;
    const response = await fetch(`/api/transactions/${id}`, { method: "DELETE" });
    if (!response.ok) { setError("Não consegui excluir a movimentação."); return; }
    setTransactions((current) => current.filter((tx) => tx.id !== id));
  }
  return <section className="page-section">
    <div className="page-heading"><div><p className="eyebrow">HISTÓRICO</p><h1>Movimentações</h1><p className="page-description">Entradas e saídas registradas na conversa.</p></div><Link className="round-action" href="/" aria-label="Registrar na conversa"><Plus size={19} /></Link></div>
    <div className="subnav-row"><span>{transactions.length} registros</span><Link href="/recurrences" className="text-link">Gerenciar recorrências <ChevronRight size={15} /></Link></div>
    {error && <div className="inline-error static" role="alert">{error}</div>}
    {loading ? <div className="empty-state">Carregando histórico…</div> : transactions.length === 0 ? <div className="empty-state"><div className="empty-icon"><ArrowDownLeft size={22} /></div><h2>Seu histórico começa aqui</h2><p>Registre uma entrada ou saída pelo chat. Você também pode enviar uma foto ou comprovante.</p><Link className="primary-button" href="/">Abrir conversa <ChevronRight size={16} /></Link></div> : <div className="transaction-list">{transactions.map((transaction) => <TransactionCard key={transaction.id} transaction={transaction} categories={categories} onCategoriesChange={setCategories} onRemove={() => void remove(transaction.id)} onSaved={load} />)}</div>}
  </section>;
}

function TransactionCard({ transaction, categories, onCategoriesChange, onRemove, onSaved }: { transaction: TransactionView; categories: CategoryOption[]; onCategoriesChange: (categories: CategoryOption[]) => void; onRemove: () => void; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [direction, setDirection] = useState(transaction.direction);
  const [amount, setAmount] = useState((transaction.amountCents / 100).toFixed(2).replace(".", ","));
  const [description, setDescription] = useState(transaction.description);
  const [merchant, setMerchant] = useState(transaction.merchant ?? "");
  const [occurredOn, setOccurredOn] = useState(transaction.occurredOn);
  const [selected, setSelected] = useState(transaction.categories);
  const [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault(); setError("");
    const response = await fetch(`/api/transactions/${transaction.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ direction, amount, description, merchant: merchant || null, occurredOn, categories: selected }) });
    const body = await response.json();
    if (!response.ok) { setError(body.error ?? "Não consegui atualizar."); return; }
    setEditing(false); onSaved();
  }
  if (editing) return <form className="transaction-card edit-card" onSubmit={(event) => void save(event)}>
    <div className="edit-card-top"><strong>Editar movimentação</strong><button type="button" className="icon-button small" aria-label="Cancelar edição" onClick={() => setEditing(false)}><X size={16} /></button></div>
    <div className="segmented-control"><button type="button" className={direction === "expense" ? "selected" : ""} onClick={() => setDirection("expense")}>Saída</button><button type="button" className={direction === "income" ? "selected" : ""} onClick={() => setDirection("income")}>Entrada</button></div>
    <div className="form-grid"><label className="form-field">Valor<input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label className="form-field">Data<input required type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} /></label><label className="form-field span-2">Descrição<input required maxLength={160} value={description} onChange={(event) => setDescription(event.target.value)} /></label><label className="form-field span-2">Destinatário<input maxLength={100} value={merchant} onChange={(event) => setMerchant(event.target.value)} /></label></div>
    <label className="field-label">Categorias</label><CategoryPicker categories={categories} value={selected} onChange={setSelected} onCategoriesChange={onCategoriesChange} />
    {error && <p className="field-error">{error}</p>}<button className="primary-button full-button" type="submit"><Save size={16} /> Salvar</button>
  </form>;
  const income = transaction.direction === "income";
  return <article className="transaction-card">
    <div className={`transaction-icon ${income ? "income" : "expense"}`}>{income ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}</div>
    <div className="transaction-details"><div className="transaction-title">{transaction.merchant ?? transaction.description}</div><div className="transaction-subtitle">{transaction.description}{transaction.merchant ? ` · ${transaction.merchant}` : ""}</div><div className="transaction-meta"><time>{new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${transaction.occurredOn}T00:00:00Z`))}</time>{transaction.categories.map((category) => <span className="mini-tag" key={category}>{category}</span>)}</div></div>
    <div className="transaction-side"><strong className={income ? "amount-income" : "amount-expense"}>{income ? "+" : "−"}{money(transaction.amountCents)}</strong><div className="row-actions"><button className="icon-button small" aria-label="Editar" onClick={() => setEditing(true)}><Pencil size={15} /></button><button className="icon-button small danger-hover" aria-label="Excluir" onClick={onRemove}><Trash2 size={15} /></button></div></div>
  </article>;
}
