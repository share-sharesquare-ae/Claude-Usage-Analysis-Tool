import { useState } from "react";
import type { FormEvent } from "react";
import { authApi, type AdminUser } from "../lib/authApi";

type Props = { onAuthenticated: (user: AdminUser) => void };

export default function LoginPage({ onAuthenticated }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(""); setSubmitting(true);
    try {
      const user = await authApi.login(email, password);
      history.replaceState(null, "", "/");
      onAuthenticated(user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to sign in");
    } finally { setSubmitting(false); }
  }

  return <main className="login-page">
    <section className="login-brand" aria-label="Resolute Corp platform introduction">
      <img src="/resolute-logo.png" alt="Resolute Corp Bharat Private Limited" />
      <div><p>Internal analytics platform</p><h1>Claude Usage<br />Intelligence</h1><span>Secure visibility into adoption, token usage, sessions and estimated cost.</span></div>
      <small>Authorized administrators only</small>
    </section>
    <section className="login-form-side">
      <form className="login-card" onSubmit={submit}>
        <p className="login-kicker">ADMIN ACCESS</p>
        <h2>Welcome back</h2>
        <p className="login-copy">Sign in with your approved organization account to continue.</p>
        <label>Organization email<input type="email" autoComplete="username" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@resolutecorp.in" required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" minLength={8} required /></label>
        {error && <div className="login-error" role="alert">{error}</div>}
        <button className="login-submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in securely"}</button>
        <p className="login-help">Access is limited to approved Resolute Corp administrators.</p>
      </form>
    </section>
  </main>;
}
