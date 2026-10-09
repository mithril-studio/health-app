"use client";
import { useEffect, useState } from "react";
import { api, ApiError, errorMessage } from "@/lib/api";
import type { CoachingRecord } from "@/lib/athlete";
import { athleteCopy as c } from "@/lib/athlete-copy";
import { timestampLabel } from "@/lib/dates";
import {
  Badge,
  Button,
  Card,
  CardHeading,
  Empty,
  ErrorNotice,
  Skeleton,
} from "./ui";
import { RecordDraft } from "./record-draft";
import { TextField } from "./athlete-text-field";
export function CoachingRecords() {
  const [records, setRecords] = useState<CoachingRecord[]>([]);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<{ records: CoachingRecord[] }>("/api/coaching-records", {
      signal: controller.signal,
    })
      .then((result) => setRecords(result.records.slice(0, 50)))
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [version]);
  return (
    <div className="athlete-records">
      <Card className="athlete-card">
        <CardHeading title={c.newRecord} description={c.recordsNote} />
        <RecordDraft
          onSaved={(record) =>
            setRecords((rows) =>
              [record, ...rows.filter((r) => r.id !== record.id)].slice(0, 50),
            )
          }
        />
      </Card>
      <Card className="athlete-card">
        <CardHeading
          title={c.records}
          action={
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => setVersion((v) => v + 1)}
            >
              {c.reloadRecords}
            </Button>
          }
        />
        {error && (
          <ErrorNotice message={error} retry={() => setVersion((v) => v + 1)} />
        )}
        {loading ? (
          <Skeleton compact />
        ) : (
          !error &&
          (records.length ? (
            <ul>
              {records.map((record) => (
                <RecordRow
                  key={`${record.id}-${record.revision}-${version}`}
                  record={record}
                  onSaved={(updated) =>
                    setRecords((rows) =>
                      rows.map((r) => (r.id === updated.id ? updated : r)),
                    )
                  }
                />
              ))}
            </ul>
          ) : (
            <Empty title={c.empty} />
          ))
        )}
      </Card>
    </div>
  );
}
function RecordRow({
  record,
  onSaved,
}: {
  record: CoachingRecord;
  onSaved: (record: CoachingRecord) => void;
}) {
  const [outcome, setOutcome] = useState(record.outcome);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  async function update(status: CoachingRecord["status"]) {
    if (busy || conflict) return;
    setBusy(true);
    setError("");
    try {
      onSaved(
        await api<CoachingRecord>(
          `/api/coaching-records/${encodeURIComponent(record.id)}`,
          {
            method: "PATCH",
            body: { revision: record.revision, status, outcome },
          },
        ),
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setConflict(true);
        setError(c.recordConflict);
      } else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <li>
      <div className="athlete-actions">
        <strong>{c.kinds[record.kind]}</strong>
        <Badge accent={record.status === "accepted"}>
          {c.statuses[record.status]}
        </Badge>
      </div>
      <p className="record-text">{record.text}</p>
      {record.rationale && (
        <p className="record-text">
          <strong>{c.rationale}: </strong>
          {record.rationale}
        </p>
      )}
      <p className="athlete-caption">
        {c.created}:{" "}
        <time dateTime={record.created_at}>
          {timestampLabel(record.created_at)}
        </time>{" "}
        · {c.changed}:{" "}
        <time dateTime={record.updated_at}>
          {timestampLabel(record.updated_at)}
        </time>
      </p>
      {error && <ErrorNotice message={error} />}
      {(record.status === "accepted" || record.status === "completed") && (
        <fieldset className="record-outcome" disabled={busy || conflict}>
          <TextField label={c.outcome} value={outcome} onChange={setOutcome} />
        </fieldset>
      )}
      {record.status === "dismissed" && record.outcome && (
        <p className="record-text">
          {c.outcome}: {record.outcome}
        </p>
      )}
      <div className="athlete-actions">
        {record.status === "proposed" && (
          <Button
            disabled={busy || conflict}
            onClick={() => void update("accepted")}
          >
            {c.accept}
          </Button>
        )}
        {(record.status === "proposed" || record.status === "accepted") && (
          <Button
            variant="outline"
            disabled={busy || conflict}
            onClick={() => void update("dismissed")}
          >
            {c.dismiss}
          </Button>
        )}
        {record.status === "accepted" && (
          <Button
            disabled={busy || conflict || !outcome.trim()}
            onClick={() => void update("completed")}
          >
            {c.complete}
          </Button>
        )}
        {record.status === "completed" && (
          <Button
            variant="outline"
            disabled={busy || conflict || outcome === record.outcome}
            onClick={() => void update("completed")}
          >
            {c.updateOutcome}
          </Button>
        )}
      </div>
    </li>
  );
}
