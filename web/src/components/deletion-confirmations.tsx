"use client";
import { useEffect, useState } from "react";
import { Trash2, ArrowRight } from "lucide-react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { pendingDeletions, type Deletion } from "@/lib/chat";
import { copy } from "@/lib/i18n";
import { dateLabel, validDate } from "@/lib/dates";
import { Button, ErrorNotice, Modal } from "./ui";
import { useTraining } from "./workspace";
export function DeletionConfirmations({ version }: { version: number }) {
  const [pending, setPending] = useState<Deletion[]>([]);
  const [selected, setSelected] = useState<Deletion | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState("");
  const { refresh } = useTraining();
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    api("/api/confirmations", { signal: controller.signal })
      .then((result) => setPending(pendingDeletions(result)))
      .catch((e) => {
        if (
          !controller.signal.aborted &&
          !(e instanceof ApiError && e.status === 404)
        )
          setError(errorMessage(e));
      });
    return () => controller.abort();
  }, [version, reload]);
  async function confirm() {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(
        `/api/confirmations/${encodeURIComponent(selected.token)}/confirm`,
        { method: "POST" },
      );
      setPending((rows) => rows.filter((r) => r.token !== selected.token));
      setSelected(null);
      setNotice(copy.coach.deleted);
      await refresh();
    } catch {
      setError(copy.coach.confirmationFailed);
    } finally {
      setBusy(false);
    }
  }
  const expired = selected
    ? !selected.expiresAt ||
      !Number.isFinite(Date.parse(selected.expiresAt)) ||
      Date.parse(selected.expiresAt) <= Date.now()
    : false;
  return (
    <>
      <div className="confirmation-list">
        {notice && (
          <p className="action-notice" role="status">
            {notice}
          </p>
        )}
        {error && !selected && (
          <ErrorNotice message={error} retry={() => setReload((v) => v + 1)} />
        )}{" "}
        {pending.map((row) => (
          <div className="confirmation-item" key={row.token}>
            <Trash2 size={16} aria-hidden="true" />
            <div>
              <strong>{row.name || copy.coach.pending}</strong>
              <span>{copy.coach.pending}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelected(row)}
            >
              {copy.common.viewDetails}
              <ArrowRight size={12} aria-hidden="true" />
            </Button>
          </div>
        ))}
      </div>
      <Modal
        open={!!selected}
        onClose={() => {
          if (!busy) {
            setSelected(null);
            setError("");
          }
        }}
        title={copy.coach.deleteTitle}
        description={copy.coach.deleteDescription}
      >
        {selected && (
          <>
            <div className="deletion-summary">
              <strong>{selected.name || copy.calendar.plannedDetails}</strong>
              <p>
                {validDate(selected.date)
                  ? dateLabel(selected.date, {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })
                  : copy.common.unknown}
              </p>
              {selected.description && (
                <div className="workout-description">
                  {selected.description}
                </div>
              )}
            </div>
            {error && <ErrorNotice message={error} />}{" "}
            {expired && <ErrorNotice message={copy.coach.expired} />}
            <div className="dialog-actions">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setSelected(null);
                  setError("");
                }}
              >
                {copy.coach.discard}
              </Button>
              <Button
                variant="destructive"
                disabled={busy || expired}
                onClick={() => void confirm()}
              >
                <Trash2 size={14} aria-hidden="true" />
                {copy.coach.confirmDelete}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
