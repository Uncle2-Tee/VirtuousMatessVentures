"use client";

import { useState } from "react";
import Link from "next/link";
import VisibilityIcon from "@mui/icons-material/VisibilityOutlined";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOffOutlined";
import BrandWordmark from "../components/brand-wordmark";

export default function SalesLogin({ configured }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/sales/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error || "Unable to sign in.");
        return;
      }
      window.location.reload();
    } catch {
      setError("Unable to reach the secure sign-in service.");
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="sales-login-shell">
    <section className="sales-login-card" aria-label="Salesperson sign in">
      <BrandWordmark className="sales-login-logo" />
      <p className="sales-eyebrow">Sales desk</p>
      <p className="sales-login-intro">{configured ? "Sign in to serve customers and record today’s sales." : "Sales desk access needs to be configured before a team member can sign in."}</p>
      {configured ? <form className="sales-login-form" onSubmit={submit}>
        <label htmlFor="sales-username">Username</label>
        <input id="sales-username" type="text" value={username} onChange={(event) => setUsername(event.target.value)} required autoComplete="username" autoFocus placeholder="Enter your sales username" />
        <label htmlFor="sales-password">Password</label>
        <span className="sales-login-password">
          <input id="sales-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" placeholder="Enter your password" />
          <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>
            {showPassword ? <VisibilityOffIcon aria-hidden="true" /> : <VisibilityIcon aria-hidden="true" />}
          </button>
        </span>
        {error && <p className="sales-login-error" role="alert">{error}</p>}
        <button className="sales-login-submit" type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in to sales desk"}<span aria-hidden="true">→</span></button>
        <p className="sales-login-security">Private, secure access for store staff.</p>
      </form> : <div className="sales-setup-note">
        <strong>Sales desk access is not set up</strong>
        <p>Ask an administrator to configure the salesperson username and password from the admin dashboard.</p>
      </div>}
      <Link className="sales-login-return" href="/">← Return to storefront</Link>
    </section>
  </main>;
}
