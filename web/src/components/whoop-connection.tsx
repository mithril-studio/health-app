"use client";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { copy } from "@/lib/i18n";
import { addDays, dateLabel, timestampLabel } from "@/lib/dates";
import { useTraining } from "./workspace";
import { Badge, Button, Card, CardHeading, ErrorNotice, Modal } from "./ui";
const w = copy.workouts;
type Status = {
  configured: boolean;
  connected: boolean;
  last_success: string | null;
  error: string | null;
};
type Imported = {
  id: string;
  name: string;
  start_date_local: string;
  duplicate_of: string | null;
};
export function WhoopConnection() {
  const { refresh, now } = useTraining();
  const [status, setStatus] = useState<Status | null>(null);
  const [workouts, setWorkouts] = useState<Imported[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const initialized = useRef(false);
  async function load() {
    setStatus(await api<Status>("/api/whoop"));
    const result = await api<{ workouts: Imported[] }>(
      `/api/whoop/workouts?oldest=${addDays(now, -90)}&newest=${now}`,
    );
    setWorkouts(
      result.workouts
        .slice()
        .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local)),
    );
  }
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const url = new URL(window.location.href),
      code = url.searchParams.get("code"),
      state = url.searchParams.get("state");
    const denied = url.searchParams.has("error");
    if (code || state || denied)
      window.history.replaceState(null, "", "/settings");
    async function initialize() {
      setBusy(true);
      try {
        if (denied || (code && !state)) setError(w.whoopError);
        if (code && state) {
          await api("/api/whoop/connect", {
            method: "POST",
            body: { code, state },
          });
          await api("/api/whoop/sync", { method: "POST", timeout: 120000 });
          await refresh();
        }
        await load();
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(false);
      }
    }
    void initialize();
    // Initialize once; OAuth codes are single-use, including under Strict Mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function action(kind: "authorize" | "sync" | "disconnect") {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ url?: string }>(`/api/whoop/${kind}`, {
        method: "POST",
        timeout: 120000,
      });
      if (kind === "authorize") {
        const url = new URL(result.url ?? "");
        if (
          url.origin !== "https://api.prod.whoop.com" ||
          url.pathname !== "/oauth/oauth2/auth"
        )
          throw new Error("Invalid WHOOP URL");
        window.location.assign(url.href);
        return;
      }
      setConfirm(false);
      await load();
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="whoop-card">
      <CardHeading
        title={w.whoop}
        description={w.whoopDetail}
        action={
          status && (
            <Badge accent={status.connected}>
              {status.connected ? w.connected : w.notConnected}
            </Badge>
          )
        }
      />
      <p className="workout-caption">{w.whoopWellness}</p>
      <p className="workout-caption">
        <a
          href="https://intervals.icu/settings"
          target="_blank"
          rel="noreferrer"
        >
          {w.intervalsSettings}
        </a>
      </p>
      {status && !status.configured ? (
        <p className="workout-caption">{w.setup}</p>
      ) : (
        <p className="workout-caption">{w.importRule}</p>
      )}
      {status?.connected && (
        <p className="workout-caption">
          {status.last_success
            ? `${w.lastSync}: ${timestampLabel(status.last_success)}`
            : w.never}
        </p>
      )}
      {(error || status?.error) && (
        <ErrorNotice
          message={error || status!.error!}
          retry={() => {
            setError("");
            void load().catch((e) => setError(errorMessage(e)));
          }}
        />
      )}
      <div className="whoop-actions">
        {status?.connected ? (
          <>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void action("sync")}
            >
              {busy ? w.busy : w.sync}
            </Button>
            {status.error && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void action("authorize")}
              >
                {w.reconnect}
              </Button>
            )}
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirm(true)}
            >
              {w.disconnect}
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            disabled={busy || !status?.configured}
            onClick={() => void action("authorize")}
          >
            {busy ? w.busy : w.connect}
          </Button>
        )}
      </div>
      {!!workouts.length && (
        <details className="whoop-history">
          <summary>
            {w.whoopHistory} · {workouts.length}
          </summary>
          <ul>
            {workouts.slice(0, 20).map((row) => (
              <li key={row.id}>
                <strong>{row.name}</strong>
                <span>{dateLabel(row.start_date_local.slice(0, 10))}</span>
                <small>{row.duplicate_of ? w.duplicate : w.imported}</small>
              </li>
            ))}
          </ul>
        </details>
      )}
      <Modal
        open={confirm}
        onClose={() => {
          if (!busy) setConfirm(false);
        }}
        title={w.disconnectTitle}
        description={w.disconnectDetail}
      >
        <div className="timer-actions">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setConfirm(false)}
          >
            {copy.common.cancel}
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => void action("disconnect")}
          >
            {w.disconnect}
          </Button>
        </div>
      </Modal>
    </Card>
  );
}
