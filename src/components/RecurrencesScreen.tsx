"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarClock, Check, Plus, Repeat2 } from "lucide-react";
import { CategoryPicker, type CategoryOption } from "./CategoryPicker";

type Recurrence = { id: string; name: string; direction: "income" | "expense"; amountCents: number; merchant: string | null; description: string; frequency: "weekly" | "monthly" | "yearly"; startOn: string; endOn: string | null; categoryIdsJson: string; active: number };
const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export function RecurrencesScreen() {
  const [rows, setRows] = useState<Recurrence[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [direction, setDirection] = useState<"income" | "expense">("expense");
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [description, setDescription] = useState("");
  const [frequency, setFrequency] = useState<"weekly" | "monthly" | "yearly">("monthly");
  const [startOn, setStartOn] = useState(today());
  const [endOn, setEndOn] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch("/api/recurrences", { cache: "no-store" });
    const body = await response.json(); setRows(body.recurrences ?? []); setCategories(body.categories ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const response = await fetch("/api/recurrences", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, direction, amount, merchant: merchant || null, description: description || name, frequency, startOn, endOn: endOn || null, categories: selected }) });
    const body = await response.json();
    if (!response.ok) { setError(body.error ?? "Não consegui criar a recorrência."); setBusy(false); return; }
    setName(""); setAmount(""); setMerchant(""); setDescription(""); setSelected([]); setShowForm(false); setBusy(false); await load();
  }

  async function toggle(row: Recurrence) {
    const response = await fetch(`/api/recurrences/${row.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: !row.active }) });
    if (response.ok) setRows((current) => current.map((item) => item.id === row.id ? { ...item, active: row.active ? 0 : 1 } : item));
  }

  return <section className="page-section">
    <div className="page-heading"><div><Link href="/transactions" className="back-link"><ArrowLeft size={14} /> Movimentações</Link><p className="eyebrow">AUTOMÁTICO</p><h1>Recorrências</h1><p className="page-description">Salários, assinaturas e valores fixos.</p></div><button className="round-action" aria-label="Criar recorrência" onClick={() => setShowForm((current) => !current)}><Plus size={19} /></button></div>
    {showForm && <form className="transaction-card recurrence-form" onSubmit={(event) => void create(event)}>
      <div className="edit-card-top"><strong>Nova recorrência</strong><span className="soft-label"><Repeat2 size={14} /> Geração automática</span></div>
      <div className="segmented-control"><button type="button" className={direction === "expense" ? "selected" : ""} onClick={() => setDirection("expense")}>Gasto fixo</button><button type="button" className={direction === "income" ? "selected" : ""} onClick={() => setDirection("income")}>Entrada fixa</button></div>
      <div className="form-grid"><label className="form-field span-2">Nome<input required maxLength={100} placeholder={direction === "income" ? "Salário" : "Assinatura"} value={name} onChange={(event) => setName(event.target.value)} /></label><label className="form-field">Valor<input required inputMode="decimal" placeholder="0,00" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label className="form-field">Frequência<select value={frequency} onChange={(event) => setFrequency(event.target.value as typeof frequency)}><option value="weekly">Toda semana</option><option value="monthly">Todo mês</option><option value="yearly">Todo ano</option></select></label><label className="form-field">Começa em<input required type="date" value={startOn} onChange={(event) => setStartOn(event.target.value)} /></label><label className="form-field">Termina em<input type="date" value={endOn} onChange={(event) => setEndOn(event.target.value)} /></label><label className="form-field span-2">Destinatário<input maxLength={100} placeholder="Opcional" value={merchant} onChange={(event) => setMerchant(event.target.value)} /></label><label className="form-field span-2">Descrição<input maxLength={160} placeholder="Ex.: mensalidade da academia" value={description} onChange={(event) => setDescription(event.target.value)} /></label></div>
      <label className="field-label">Categorias</label><CategoryPicker categories={categories} value={selected} onChange={setSelected} onCategoriesChange={setCategories} />
      <p className="helper-note"><CalendarClock size={14} /> Se o app estiver fechado no vencimento, o lançamento aparece quando ele for aberto novamente.</p>
      {error && <p className="field-error">{error}</p>}<button className="primary-button full-button" type="submit" disabled={busy}><Check size={16} /> {busy ? "Salvando…" : "Criar recorrência"}</button>
    </form>}
    {rows.length === 0 ? <div className="empty-state"><div className="empty-icon"><Repeat2 size={22} /></div><h2>Nenhuma recorrência ainda</h2><p>Cadastre salário, aluguel e assinaturas para organizar valores fixos.</p><button className="primary-button" onClick={() => setShowForm(true)}>Criar recorrência <Plus size={16} /></button></div> : <div className="recurrence-list">{rows.map((row) => {
      const names = categories.filter((category) => (JSON.parse(row.categoryIdsJson) as string[]).includes(category.id)).map((category) => category.name);
      return <article className={`recurrence-card ${!row.active ? "disabled" : ""}`} key={row.id}><div className="recurrence-symbol"><Repeat2 size={18} /></div><div className="recurrence-main"><div className="transaction-title">{row.name}</div><div className="transaction-subtitle">{row.merchant ?? row.description}</div><div className="transaction-meta"><span>{row.frequency === "monthly" ? "Mensal" : row.frequency === "weekly" ? "Semanal" : "Anual"}</span><span>Desde {new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${row.startOn}T00:00:00Z`))}</span>{names.map((category) => <span className="mini-tag" key={category}>{category}</span>)}</div></div><div className="recurrence-right"><strong className={row.direction === "income" ? "amount-income" : "amount-expense"}>{row.direction === "income" ? "+" : "−"}{money(row.amountCents)}</strong><button className={`toggle-switch ${row.active ? "on" : ""}`} role="switch" aria-checked={Boolean(row.active)} aria-label={`${row.active ? "Pausar" : "Ativar"} ${row.name}`} onClick={() => void toggle(row)}><span /></button></div></article>;
    })}</div>}
  </section>;
}
