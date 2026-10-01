"use client";
import { useState, type FormEvent } from "react";
import { ArrowRight, LockKeyhole, ArrowUpRight } from "lucide-react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { copy } from "@/lib/i18n";
import { Button, ErrorNotice, Mark } from "./ui";
export function Login({ onLogin }: { onLogin: () => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/login", { method: "POST", body: { password } });
      setPassword("");
      await onLogin();
    } catch (e) {
      setError(
        e instanceof ApiError && (e.status === 401 || e.status === 403)
          ? copy.login.invalid
          : errorMessage(e),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <div className="login-art">
        <a href="/" className="brand">
          <Mark />
          <span>{copy.brand}</span>
        </a>
        <div className="track-art" aria-hidden="true">
          <div />
          <div />
          <div />
          <div />
          <div />
          <span>
            <ArrowUpRight strokeWidth={1} />
          </span>
        </div>
        <div className="art-caption">
          <p className="eyebrow">{copy.login.strap}</p>
          <p>{copy.login.caption}</p>
        </div>
      </div>
      <div className="login-panel">
        <div className="login-mobile-brand brand">
          <Mark />
          <span>{copy.brand}</span>
        </div>
        <div className="login-form-wrap">
          <p className="eyebrow">{copy.login.eyebrow}</p>
          <h1>{copy.login.title}</h1>
          <p className="login-description">{copy.login.description}</p>
          <form onSubmit={submit}>
            <label htmlFor="password">{copy.login.password}</label>
            <div className="password-field">
              <LockKeyhole size={16} aria-hidden="true" />
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder={copy.login.placeholder}
                value={password}
                maxLength={1024}
                required
                aria-invalid={!!error}
                aria-describedby={error ? "login-error" : undefined}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <div id="login-error">
                <ErrorNotice message={error} />
              </div>
            )}
            <Button
              type="submit"
              disabled={busy || !password}
              className="login-submit"
            >
              {busy ? copy.login.submitting : copy.login.submit}
              {busy ? (
                <Mark className="loading-mark" />
              ) : (
                <ArrowRight size={16} aria-hidden="true" />
              )}
            </Button>
          </form>
          <p className="login-footer">{copy.login.footer}</p>
        </div>
        <div className="login-security">
          <LockKeyhole size={13} aria-hidden="true" />
          {copy.login.secure}
        </div>
      </div>
    </main>
  );
}
