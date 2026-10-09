"use client";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import type { CoachingRecord } from "@/lib/athlete";
import { athleteCopy as c } from "@/lib/athlete-copy";
import { copy } from "@/lib/i18n";
import { Button, ErrorNotice } from "./ui";
import { TextField } from "./athlete-text-field";
import "./athlete.css";
type Proposal = Pick<CoachingRecord, "id" | "kind" | "text" | "rationale">;
export function RecordDraft({
  initialText = "",
  onSaved,
  onPendingChange,
}: {
  initialText?: string;
  onSaved?: (record: CoachingRecord) => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const [text, setText] = useState(initialText);
  const [rationale, setRationale] = useState("");
  const [kind, setKind] = useState<CoachingRecord["kind"]>("recommendation");
  const [attempt, setAttempt] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function save() {
    if (busy || !text.trim() || text.length > 4000) return;
    const next = attempt ?? {
      id: crypto.randomUUID(),
      kind,
      text: text.trim(),
      rationale: rationale.trim(),
    };
    setAttempt(next);
    setBusy(true);
    setError("");
    setSaved(false);
    onPendingChange?.(true);
    try {
      const record = await api<CoachingRecord>("/api/coaching-records", {
        method: "POST",
        body: next,
      });
      setAttempt(null);
      setText("");
      setRationale("");
      setSaved(true);
      onPendingChange?.(false);
      onSaved?.(record);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="athlete-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <fieldset disabled={busy || !!attempt}>
        <div className="athlete-field">
          <label htmlFor="record-kind">{c.kind}</label>
          <select
            id="record-kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as CoachingRecord["kind"]);
              setSaved(false);
            }}
          >
            <option value="observation">{c.kinds.observation}</option>
            <option value="recommendation">{c.kinds.recommendation}</option>
            <option value="question">{c.kinds.question}</option>
          </select>
        </div>
        <TextField
          label={c.text}
          value={text}
          onChange={(v) => {
            setText(v);
            setSaved(false);
          }}
          max={4000}
          required
        />
        <TextField
          label={c.rationale}
          value={rationale}
          onChange={(v) => {
            setRationale(v);
            setSaved(false);
          }}
        />
      </fieldset>
      {text.length > 4000 && <p role="alert">{c.tooLong}</p>}
      {error && (
        <>
          <ErrorNotice message={error} />
          <p className="athlete-caption">{c.retryNote}</p>
        </>
      )}
      <div className="athlete-actions">
        <Button
          type="submit"
          disabled={busy || !text.trim() || text.length > 4000}
        >
          {busy ? c.saving : attempt ? copy.common.retry : c.propose}
        </Button>
        <span role="status">{saved ? c.proposalSaved : ""}</span>
      </div>
    </form>
  );
}
