"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Download, ShieldCheck, Trash2 } from "lucide-react";

export function AccountScreen() {
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function removeAccount(event: FormEvent) {
    event.preventDefault();
    if (confirmation !== "EXCLUIR" || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/account/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmation }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível excluir a conta.");
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login?account-deleted=1");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao excluir a conta.");
      setBusy(false);
    }
  }

  return <section className="page-section">
    <div className="page-heading"><div><Link href="/" className="back-link"><ArrowLeft size={14} /> Início</Link><p className="eyebrow">PRIVACIDADE</p><h1>Sua conta</h1><p className="page-description">Acesse seus dados ou encerre sua conta.</p></div><ShieldCheck size={22} /></div>
    <article className="transaction-card account-card">
      <h2>Seus dados</h2>
      <p>Baixe um arquivo JSON com suas mensagens, movimentações, carteiras, categorias, recorrências e anexos.</p>
      <a className="primary-button" href="/api/account/export"><Download size={16} /> Baixar meus dados</a>
      <p><Link href="/privacy">Aviso de privacidade</Link> · <Link href="/terms">Termos do beta</Link></p>
    </article>
    <article className="transaction-card account-card danger-card">
      <h2>Excluir conta</h2>
      <p>A exclusão remove seu acesso e apaga os dados financeiros e arquivos associados à conta. Exporte o que quiser guardar antes de continuar.</p>
      <form onSubmit={(event) => void removeAccount(event)}>
        <label className="form-field">Digite EXCLUIR para confirmar<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button className="primary-button danger-button" type="submit" disabled={confirmation !== "EXCLUIR" || busy}><Trash2 size={16} /> {busy ? "Excluindo…" : "Excluir minha conta"}</button>
      </form>
    </article>
  </section>;
}
