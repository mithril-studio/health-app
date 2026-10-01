"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { normalizeDashboard, type Dashboard } from "@/lib/data";
import { addDays, today } from "@/lib/dates";
import { copy } from "@/lib/i18n";
import { Login } from "./login";
import { Shell } from "./shell";
import { SourceNotice } from "./source-notice";
import { ErrorNotice, Mark, Skeleton, Button, Empty } from "./ui";

type Context = { data: Dashboard | null; loading: boolean; error: string; syncing: boolean; refresh: (sync?: boolean) => Promise<void>; reloadRange: (oldest: string, newest: string) => Promise<void>; setData: React.Dispatch<React.SetStateAction<Dashboard | null>>; now: string };
const TrainingContext = createContext<Context | null>(null);
export function useTraining() { const value = useContext(TrainingContext); if (!value) throw new Error("Training context missing"); return value; }
export function Workspace({ children, theme, sidebarOpen }: { children: ReactNode; theme: "light" | "dark"; sidebarOpen: boolean }) {
  const [auth, setAuth] = useState<"checking" | "in" | "out" | "error">("checking");
  const [authError, setAuthError] = useState("");
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(today);
  const range = useRef({ oldest: addDays(now, -365), newest: addDays(now, 62) });
  const request = useRef(0);
  const authenticated = useRef(false);
  const checkSession = useCallback(async () => {
    try {
      const session = await api<{ authenticated: boolean }>("/api/session");
      authenticated.current = session.authenticated === true;
      setAuth(authenticated.current ? "in" : "out");
      if (!authenticated.current) { request.current++; setData(null); }
    } catch (e) { authenticated.current = false; request.current++; setData(null); setAuthError(errorMessage(e)); setAuth("error"); }
  }, []);
  const load = useCallback(async () => {
    if (!authenticated.current) return;
    const id = ++request.current;
    setLoading(true); setError("");
    try {
      const result = await api(`/api/dashboard?${new URLSearchParams(range.current)}`);
      if (request.current === id && authenticated.current) setData(normalizeDashboard(result));
    } catch (e) { if (request.current === id) setError(errorMessage(e)); throw e; }
    finally { if (request.current === id) setLoading(false); }
  }, []);
  const refresh = useCallback(async (sync = false) => {
    if (sync) setSyncing(true);
    try { if (sync) await api("/api/sync", { method: "POST", timeout: 120000 }); await load(); }
    catch (e) { setError(errorMessage(e)); }
    finally { if (sync) setSyncing(false); }
  }, [load]);
  const reloadRange = useCallback(async (oldest: string, newest: string) => {
    const previous = range.current;
    if (oldest >= previous.oldest && newest <= previous.newest && data) return;
    range.current = { oldest: oldest < previous.oldest ? oldest : previous.oldest, newest: newest > previous.newest ? newest : previous.newest };
    try { await load(); } catch (e) { range.current = previous; throw e; }
  }, [load, data]);
  useEffect(() => {
    void checkSession();
    const clear = () => { authenticated.current = false; request.current++; setData(null); setAuth("out"); setLoading(false); };
    const recheck = () => { if (document.visibilityState === "visible") { setNow(today()); void checkSession(); } };
    window.addEventListener("reachy:unauthorized", clear);
    window.addEventListener("pageshow", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => { window.removeEventListener("reachy:unauthorized", clear); window.removeEventListener("pageshow", recheck); document.removeEventListener("visibilitychange", recheck); };
  }, [checkSession]);
  useEffect(() => { if (auth === "in") void refresh(); }, [auth, refresh]);
  if (auth === "checking") return <div className="session-screen" role="status"><Mark className="loading-mark" /><p>{copy.common.checking}</p></div>;
  if (auth === "error") return <div className="session-screen"><Mark /><ErrorNotice message={authError} retry={() => void checkSession()} /></div>;
  if (auth === "out") return <Login onLogin={checkSession} />;
  return <TrainingContext.Provider value={{ data, loading, error, syncing, refresh, reloadRange, setData, now }}><Shell theme={theme} sidebarOpen={sidebarOpen} onLogout={async () => { await api("/api/logout", { method: "POST" }); authenticated.current = false; request.current++; setData(null); setAuth("out"); }}>{children}</Shell></TrainingContext.Provider>;
}
export function DataGate({ children }: { children: ReactNode }) {
  const { data, loading, error, refresh } = useTraining();
  if (!data && loading) return <Skeleton />;
  if (!data) return <div className="card"><Empty title={copy.sync.errorTitle} description={copy.sync.errorDetail} />{error && <ErrorNotice message={error} />}<div className="center-action"><Button onClick={() => void refresh()}>{copy.common.retry}</Button></div></div>;
  return <><SourceNotice data={data} />{children}</>;
}
