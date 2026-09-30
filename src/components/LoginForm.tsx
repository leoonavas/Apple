"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole } from "lucide-react";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível entrar.");
      router.replace("/"); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Falha ao entrar."); }
    finally { setBusy(false); }
  }
  return <main className="login-page">
    <div className="login-card">
      <div className="brand-mark large">a.</div>
      <p className="eyebrow">APPLE FINANÇAS</p>
      <h1>Suas finanças.<br /><span>Do seu jeito.</span></h1>
      <p className="login-copy">Entre na sua conta para acessar suas finanças com segurança.</p>
      <form onSubmit={(event) => void submit(event)}>
        <label className="field-label" htmlFor="email">E-mail</label>
        <div className="password-input"><input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></div>
        <label className="field-label" htmlFor="password">Senha de acesso</label>
        <div className="password-input"><LockKeyhole size={17} /><input id="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></div>
        {error && <p role="alert" className="inline-error static">{error}</p>}
        <button className="primary-button login-submit" type="submit" disabled={busy}>{busy ? "Entrando…" : "Entrar"}<ArrowRight size={16} /></button>
      </form>
      <p className="privacy-note"><a href="/forgot-password">Esqueci minha senha</a></p>
      <p className="privacy-note">Ainda não tem conta? <a href="/signup">Criar conta</a></p>
      <p className="privacy-note"><a href="/privacy">Privacidade</a> · <a href="/terms">Termos do beta</a></p>
    </div>
  </main>;
}
