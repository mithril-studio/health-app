"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, errorMessage } from "@/lib/api";
import {
  normalizeDashboard,
  normalizeCurves,
  curveFiveK,
  type FiveKEffort,
  type CurvePoint,
  type Dashboard,
} from "@/lib/data";
import { addDays, today } from "@/lib/dates";
import { copy } from "@/lib/i18n";
import { Login, type SessionCheck } from "./login";
import { Shell } from "./shell";
import { ErrorNotice, Mark, Skeleton, Button, Empty } from "./ui";

type Context = {
  data: Dashboard | null;
  loading: boolean;
  error: string;
  syncing: boolean;
  refresh: (sync?: boolean) => Promise<void>;
  runCurve: {
    points: CurvePoint[];
    best: FiveKEffort | null;
    loading: boolean;
    error: string;
  };
  now: string;
};
const TrainingContext = createContext<Context | null>(null);
export function useTraining() {
  const value = useContext(TrainingContext);
  if (!value) throw new Error("Training context missing");
  return value;
}
export function Workspace({
  children,
  theme,
  sidebarOpen,
}: {
  children: ReactNode;
  theme: "light" | "dark";
  sidebarOpen: boolean;
}) {
  const [auth, setAuth] = useState<"checking" | "in" | "out" | "error">(
    "checking",
  );
  const [authError, setAuthError] = useState("");
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(today);
  const [runCurve, setRunCurve] = useState<Context["runCurve"]>({
    points: [],
    best: null,
    loading: true,
    error: "",
  });
  const range = useRef({
    oldest: addDays(now, -365),
    newest: addDays(now, 62),
  });
  const request = useRef(0);
  const authenticated = useRef(false);
  const sessionRequest = useRef(0);
  const checkSession = useCallback(async () => {
    const generation = ++sessionRequest.current;
    try {
      const session = await api<SessionCheck>("/api/session");
      if (generation !== sessionRequest.current)
        return { authenticated: authenticated.current };
      authenticated.current = session.authenticated === true;
      setAuth(authenticated.current ? "in" : "out");
      if (!authenticated.current) {
        request.current++;
        setData(null);
      }
      return session;
    } catch (e) {
      if (generation !== sessionRequest.current)
        return { authenticated: authenticated.current };
      authenticated.current = false;
      request.current++;
      setData(null);
      setAuthError(errorMessage(e));
      setAuth("error");
      return { authenticated: false };
    }
  }, []);
  const load = useCallback(async () => {
    if (!authenticated.current) return;
    const id = ++request.current;
    setLoading(true);
    setError("");
    try {
      const result = await api(
        `/api/dashboard?${new URLSearchParams(range.current)}`,
      );
      if (request.current === id && authenticated.current)
        setData(normalizeDashboard(result));
    } catch (e) {
      if (request.current === id) setError(errorMessage(e));
      throw e;
    } finally {
      if (request.current === id) setLoading(false);
    }
  }, []);
  const refresh = useCallback(
    async (sync = false) => {
      if (sync) setSyncing(true);
      try {
        if (sync) await api("/api/sync", { method: "POST", timeout: 120000 });
        await load();
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        if (sync) setSyncing(false);
      }
    },
    [load],
  );
  useEffect(() => {
    if (!data || !authenticated.current) {
      setRunCurve({ points: [], best: null, loading: true, error: "" });
      return;
    }
    const controller = new AbortController();
    setRunCurve((previous) => ({ ...previous, loading: true, error: "" }));
    api("/api/curves?sport=Run&period=84", { signal: controller.signal })
      .then((result) => {
        setRunCurve({
          points: normalizeCurves(result, "Run"),
          best: curveFiveK(result),
          loading: false,
          error: "",
        });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setRunCurve({
            points: [],
            best: null,
            loading: false,
            error: errorMessage(error),
          });
      });
    return () => controller.abort();
  }, [data]);
  useEffect(() => {
    void checkSession();
    const clear = () => {
      sessionRequest.current++;
      authenticated.current = false;
      request.current++;
      setData(null);
      setAuth("out");
      setLoading(false);
    };
    const recheck = () => {
      if (document.visibilityState === "visible") {
        setNow(today());
        void checkSession();
      }
    };
    window.addEventListener("reachy:unauthorized", clear);
    window.addEventListener("pageshow", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("reachy:unauthorized", clear);
      window.removeEventListener("pageshow", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [checkSession]);
  useEffect(() => {
    if (auth === "in") void refresh();
  }, [auth, refresh]);
  if (auth === "checking")
    return (
      <div className="session-screen" role="status">
        <Mark className="loading-mark" />
        <p>{copy.common.checking}</p>
      </div>
    );
  if (auth === "error")
    return (
      <div className="session-screen">
        <Mark />
        <ErrorNotice message={authError} retry={() => void checkSession()} />
      </div>
    );
  if (auth === "out") return <Login onLogin={checkSession} />;
  return (
    <TrainingContext.Provider
      value={{ data, loading, error, syncing, refresh, runCurve, now }}
    >
      <Shell
        theme={theme}
        sidebarOpen={sidebarOpen}
        onLogout={async () => {
          await api("/api/logout", { method: "POST" });
          sessionRequest.current++;
          authenticated.current = false;
          request.current++;
          setData(null);
          setAuth("out");
        }}
      >
        {children}
      </Shell>
    </TrainingContext.Provider>
  );
}
export function DataGate({ children }: { children: ReactNode }) {
  const { data, loading, error, refresh } = useTraining();
  if (!data && (loading || !error)) return <Skeleton />;
  if (!data)
    return (
      <div className="card">
        <Empty
          title={copy.sync.errorTitle}
          description={copy.sync.errorDetail}
        />
        {error && <ErrorNotice message={error} />}
        <div className="center-action">
          <Button onClick={() => void refresh()}>{copy.common.retry}</Button>
        </div>
      </div>
    );
  return <>{children}</>;
}
