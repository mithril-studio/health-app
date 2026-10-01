"use client";
import { useState, type FormEvent } from "react";
import { ArrowRight, LockKeyhole, ArrowUpRight } from "lucide-react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { copy } from "@/lib/i18n";
import { Button, ErrorNotice, Mark } from "./ui";
export type SessionCheck = {
  authenticated: boolean;
  cookie_received?: boolean;
};
export function Login({ onLogin }: { onLogin: () => Promise<SessionCheck> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    // Read the native field: autofill need not emit a React change event.
    const form = event.currentTarget;
    const password = new FormData(form).get("password");
    if (typeof password !== "string" || !password) {
      setError(copy.login.placeholder);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/api/login", { method: "POST", body: { password } });
      const session = await onLogin();
      if (!session.authenticated) {
        throw new ApiError(
          409,
          session.cookie_received === false
            ? copy.login.cookieMissing
            : session.cookie_received === true
              ? copy.login.cookieRejected
              : copy.login.sessionMissing,
        );
      }
      form.reset();
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 429
          ? copy.login.rateLimit
          : e instanceof ApiError && (e.status === 401 || e.status === 403)
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
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={1024}
                required
                aria-invalid={!!error}
                aria-describedby={error ? "login-error" : undefined}
              />
            </div>
            {error && (
              <div id="login-error">
                <ErrorNotice message={error} />
              </div>
            )}
            <Button type="submit" disabled={busy} className="login-submit">
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
