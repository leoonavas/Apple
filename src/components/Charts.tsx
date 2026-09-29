"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ChartSpec } from "@/lib/finance/types";

const format = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value / 100);

export function ChartView({ chart }: { chart: ChartSpec }) {
  return <section className="chart-card" aria-label={chart.title}>
    <div className="chart-title">{chart.title}</div>
    <div className="chart-area">
      <ResponsiveContainer width="100%" height="100%">
        {chart.type === "line" ? <LineChart data={chart.data} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="#28282d" vertical={false} />
          <XAxis dataKey="label" stroke="#85858d" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} minTickGap={26} />
          <YAxis stroke="#85858d" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} tickFormatter={format} width={76} />
          <Tooltip contentStyle={{ background: "#1a1a1f", border: "1px solid #34343a", borderRadius: 12 }} formatter={(value) => format(Number(value))} />
          <Line type="monotone" dataKey="income" name="Entradas" stroke="#f4f4f5" strokeWidth={2.5} dot={false} />
          <Line type="monotone" dataKey="expense" name="Saídas" stroke="#8d8d98" strokeWidth={2.5} dot={false} />
        </LineChart> : <BarChart data={chart.data} layout="vertical" margin={{ top: 6, right: 14, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#28282d" horizontal={false} />
          <XAxis type="number" stroke="#85858d" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} tickFormatter={format} />
          <YAxis type="category" dataKey="label" stroke="#c8c8ce" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={100} />
          <Tooltip contentStyle={{ background: "#1a1a1f", border: "1px solid #34343a", borderRadius: 12 }} formatter={(value) => format(Number(value))} />
          <Bar dataKey="value" name="Gastos" fill="#ededf0" radius={[0, 6, 6, 0]} maxBarSize={18} />
        </BarChart>}
      </ResponsiveContainer>
    </div>
    {chart.type === "line" && <div className="chart-legend"><span><i className="legend-income" />Entradas</span><span><i className="legend-expense" />Saídas</span></div>}
  </section>;
}
