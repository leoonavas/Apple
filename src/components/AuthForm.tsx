"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, LockKeyhole, Mail } from "lucide-react";

type Mode = "signup" | "forgot" | "reset";
const copy = {
  signup: { title: "Crie sua conta", description: "Confirme seu e-mail para começar a organizar suas finanças.", endpoint: "/api/auth/signup", button: "Criar conta" },
  forgot: { title: "Recuperar acesso", description: "Enviaremos um link para redefinir sua senha.", endpoint: "/api/auth/forgot-password", button: "Enviar link" },
  reset: { title: "Nova senha", description: "Escolha uma senha com pelo menos 10 caracteres.", endpoint: "/api/auth/update-password", button: "Salvar senha" },
} satisfies Record<Mode, { title: string; description: string; endpoint: string; button: string }>;

export function AuthForm({ mode }: { mode: Mode }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const config = copy[mode];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const payload = mode === "signup" ? { email, password } : mode === "forgot" ? { email } : { password };
      const response = await fetch(config.endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível concluir a solicitação.");
      if (mode === "reset") {
        window.location.assign("/login?password-updated=1");
        return;
      }
      setMessage(body.message ?? "Solicitação concluída.");
      setPassword("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha na solicitação."); }
    finally { setBusy(false); }
  }

  return <main className="login-page"><div className="login-card">
    <div className="brand-mark large">a.</div><p className="eyebrow">APPLE FINANÇAS</p>
    <h1>{config.title}<br /><span>no seu controle.</span></h1><p className="login-copy">{config.description}</p>
    <form onSubmit={(event) => void submit(event)}>
      {mode !== "reset" && <><label className="field-label" htmlFor="email">E-mail</label><div className="password-input"><Mail size={17} /><input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></div></>}
      {mode !== "forgot" && <><label className="field-label" htmlFor="password">{mode === "reset" ? "Nova senha" : "Senha"}</label><div className="password-input"><LockKeyhole size={17} /><input id="password" type="password" autoComplete={mode === "reset" ? "new-password" : "new-password"} minLength={10} required value={password} onChange={(event) => setPassword(event.target.value)} /></div></>}
      {error && <p role="alert" className="inline-error static">{error}</p>}
      {message && <p role="status" className="privacy-note">{message}</p>}
      <button className="primary-button login-submit" type="submit" disabled={busy}>{busy ? "Aguarde…" : config.button}<ArrowRight size={16} /></button>
    </form>
    <p className="privacy-note"><a href="/login">Voltar para entrar</a>{mode === "signup" && <> · <a href="/forgot-password">Esqueci minha senha</a></>}</p>
    <p className="privacy-note"><a href="/privacy">Privacidade</a> · <a href="/terms">Termos do beta</a></p>
  </div></main>;
}
