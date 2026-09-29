"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

export type CategoryOption = { id: string; name: string };

export function CategoryPicker({ categories, value, onChange, onCategoriesChange }: { categories: CategoryOption[]; value: string[]; onChange: (value: string[]) => void; onCategoriesChange: (categories: CategoryOption[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  async function add() {
    setError("");
    const response = await fetch("/api/categories", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    const body = await response.json();
    if (!response.ok) { setError(body.error ?? "Não consegui criar a categoria."); return; }
    const next = [...categories, body as CategoryOption];
    onCategoriesChange(next); onChange([...value, body.name]); setName(""); setAdding(false);
  }
  return <div className="category-picker">
    <div className="category-chips">{categories.map((category) => {
      const active = value.includes(category.name);
      return <button type="button" key={category.id} className={`category-chip ${active ? "selected" : ""}`} aria-pressed={active} onClick={() => onChange(active ? value.filter((item) => item !== category.name) : [...value, category.name])}>{category.name}</button>;
    })}</div>
    {adding ? <div className="add-category"><input autoFocus maxLength={32} placeholder="Nome da categoria" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void add(); } }} /><button type="button" aria-label="Salvar categoria" onClick={() => void add()}><Plus size={16} /></button><button type="button" aria-label="Cancelar" onClick={() => setAdding(false)}><X size={15} /></button></div> : <button type="button" className="add-category-link" onClick={() => setAdding(true)}><Plus size={14} /> Nova categoria</button>}
    {error && <p className="field-error">{error}</p>}
  </div>;
}
