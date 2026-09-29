"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, CalendarDays, ChevronRight, WalletCards } from "lucide-react";
import { ChartView } from "./Charts";
import type { ChartSpec } from "@/lib/finance/types";

type SummaryData = { periodLabel: string; expenseCents: number; incomeCents: number; netCents: number; count: number; categoryRows: Array<{ name: string; cents: number; count: number }>; chart: ChartSpec | null };
const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const periods = [{ id: "today", label: "Hoje" }, { id: "week", label: "Semana" }, { id: "month", label: "Mês" }, { id: "all", label: "Tudo" }] as const;

export function SummaryScreen() {
  const [period, setPeriod] = useState<(typeof periods)[number]["id"]>("month");
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (next = period) => {
    setLoading(true);
    const response = await fetch(`/api/report?period=${next}&groupBy=${next === "all" ? "month" : next === "week" ? "day" : "day"}`, { cache: "no-store" });
    setData(await response.json()); setLoading(false);
  }, [period]);
  useEffect(() => { void load(period); }, [load, period]);
  return <section className="page-section summary-page">
    <div className="page-heading"><div><p className="eyebrow">SEU DINHEIRO EM PERSPECTIVA</p><h1>Resumo</h1><p className="page-description">Entradas e saídas que você registrou.</p></div><div className="heading-icon"><CalendarDays size={20} /></div></div>
    <div className="period-switch" role="tablist" aria-label="Período do resumo">{periods.map((item) => <button role="tab" aria-selected={period === item.id} key={item.id} className={period === item.id ? "active" : ""} onClick={() => setPeriod(item.id)}>{item.label}</button>)}</div>
    {loading || !data ? <div className="empty-state">Atualizando resumo…</div> : <>
      <div className="summary-period-label">{data.periodLabel}</div>
      <div className="metric-grid">
        <MetricCard label="Entradas" amount={data.incomeCents} icon={<ArrowDownLeft size={17} />} kind="income" />
        <MetricCard label="Saídas" amount={data.expenseCents} icon={<ArrowUpRight size={17} />} kind="expense" />
        <div className="net-card"><div className="metric-icon"><WalletCards size={17} /></div><span>Resultado registrado</span><strong>{money(data.netCents)}</strong><small>Entradas menos saídas</small></div>
      </div>
      {data.count ? <div className="summary-chart-wrap">{data.chart && <ChartView chart={data.chart} />}</div> : <div className="empty-state compact"><h2>Ainda sem dados neste período</h2><p>Registre suas movimentações e o resumo aparece aqui.</p><Link className="text-link" href="/">Registrar no chat <ChevronRight size={15} /></Link></div>}
      <div className="summary-bottom"><h2>Categorias</h2><Link href="/" className="text-link">Perguntar à IA <ChevronRight size={15} /></Link></div>
      {data.categoryRows.length ? <div className="category-list">{data.categoryRows.slice(0, 8).map((row) => <div className="category-row" key={row.name}><span className="category-bullet" /><span className="category-name">{row.name}</span><span className="category-count">{row.count}</span><strong>{money(row.cents)}</strong></div>)}</div> : <p className="muted-note">As categorias aparecerão conforme os gastos forem registrados.</p>}
      <p className="overlap-note">Uma movimentação pode pertencer a mais de uma categoria. O resultado geral conta cada movimentação uma só vez.</p>
    </>}
  </section>;
}

function MetricCard({ label, amount, icon, kind }: { label: string; amount: number; icon: ReactNode; kind: "income" | "expense" }) {
  return <div className={`metric-card ${kind}`}><div className="metric-icon">{icon}</div><span>{label}</span><strong>{money(amount)}</strong></div>;
}
