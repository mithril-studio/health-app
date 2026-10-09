"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/api";
import { copy } from "@/lib/i18n";
import { Button, Card, CardHeading, ErrorNotice, Skeleton } from "./ui";

type Scores = {
  lt1_hr: number | null;
  lt2_hr: number | null;
  vo2max: number | null;
  hr_zones?: { min_bpm: number; max_bpm: number }[] | null;
};
type Draft = Record<"lt1_hr" | "lt2_hr" | "vo2max", string>;
type ZoneDraft = { min_bpm: string; max_bpm: string };
const emptyZones = (): ZoneDraft[] =>
  Array.from({ length: 5 }, () => ({ min_bpm: "", max_bpm: "" }));
const toZones = (scores: Scores): ZoneDraft[] =>
  scores.hr_zones?.map((zone) => ({
    min_bpm: String(zone.min_bpm),
    max_bpm: String(zone.max_bpm),
  })) ?? emptyZones();
const empty: Draft = { lt1_hr: "", lt2_hr: "", vo2max: "" };
const toDraft = (scores: Scores): Draft => ({
  lt1_hr: scores.lt1_hr?.toString() ?? "",
  lt2_hr: scores.lt2_hr?.toString() ?? "",
  vo2max: scores.vo2max?.toString() ?? "",
});

export function AthleteScores() {
  const [draft, setDraft] = useState<Draft>(empty);
  const [saved, setSaved] = useState<Draft | null>(null);
  const [zones, setZones] = useState<ZoneDraft[]>(emptyZones);
  const [savedZones, setSavedZones] = useState<ZoneDraft[]>(emptyZones);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<Scores>("/api/athlete-scores", { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        const values = toDraft(result);
        setDraft(values);
        setSaved(values);
        setZones(toZones(result));
        setSavedZones(toZones(result));
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [retry]);

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const values: Scores = {
        lt1_hr: draft.lt1_hr === "" ? null : Number(draft.lt1_hr),
        lt2_hr: draft.lt2_hr === "" ? null : Number(draft.lt2_hr),
        vo2max: draft.vo2max === "" ? null : Number(draft.vo2max),
        hr_zones: zones.every(
          (zone) => zone.min_bpm === "" && zone.max_bpm === "",
        )
          ? null
          : zones.map((zone) => ({
              min_bpm: Number(zone.min_bpm),
              max_bpm: Number(zone.max_bpm),
            })),
      };
      setNotice("");
      if (
        values.hr_zones?.some(
          (zone, index, all) =>
            !Number.isInteger(zone.min_bpm) ||
            !Number.isInteger(zone.max_bpm) ||
            zone.min_bpm < 30 ||
            zone.max_bpm > 250 ||
            zone.min_bpm > zone.max_bpm ||
            (index > 0 && zone.min_bpm !== all[index - 1].max_bpm + 1),
        )
      ) {
        setError(copy.scores.zonesError);
        return;
      }
      if (
        values.lt1_hr !== null &&
        values.lt2_hr !== null &&
        values.lt1_hr >= values.lt2_hr
      ) {
        setError(copy.scores.orderError);
        return;
      }
      setSaving(true);
      setError("");
      try {
        const result = await api<Scores>("/api/athlete-scores", {
          method: "POST",
          body: values,
        });
        const confirmed = toDraft(result);
        setDraft(confirmed);
        setSaved(confirmed);
        setZones(toZones(result));
        setSavedZones(toZones(result));
        setNotice(copy.scores.saved);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setSaving(false);
      }
    },
    [draft, zones],
  );

  const fields = [
    {
      key: "lt1_hr",
      label: copy.scores.lt1,
      hint: copy.scores.lt1Hint,
      unit: copy.common.bpm,
      min: 30,
      max: 250,
      step: 1,
    },
    {
      key: "lt2_hr",
      label: copy.scores.lt2,
      hint: copy.scores.lt2Hint,
      unit: copy.common.bpm,
      min: 30,
      max: 250,
      step: 1,
    },
    {
      key: "vo2max",
      label: copy.scores.vo2max,
      hint: copy.scores.vo2maxHint,
      unit: copy.scores.vo2maxUnit,
      min: 5,
      max: 100,
      step: "any",
    },
  ] as const;
  const dirty =
    saved &&
    (fields.some(({ key }) => draft[key] !== saved[key]) ||
      JSON.stringify(zones) !== JSON.stringify(savedZones));

  return (
    <Card className="athlete-scores">
      <CardHeading
        title={copy.scores.title}
        description={copy.scores.description}
      />
      {loading ? (
        <Skeleton compact />
      ) : saved === null ? (
        <div className="card-body">
          <ErrorNotice message={error} retry={() => setRetry((v) => v + 1)} />
        </div>
      ) : (
        <form className="card-body scores-form" onSubmit={submit}>
          <p>{copy.scores.note}</p>
          <fieldset disabled={saving} className="scores-zone-fields">
            <legend>{copy.scores.zones}</legend>
            <p id="scores-zone-hint">{copy.scores.zonesHint}</p>
            <div
              className="score-zone-row score-zone-heading"
              aria-hidden="true"
            >
              <span>{copy.scores.zone}</span>
              <span>{copy.scores.zoneFrom}</span>
              <span>{copy.scores.zoneTo}</span>
            </div>
            {zones.map((zone, index) => (
              <div className="score-zone-row" key={index}>
                <strong>Z{index + 1}</strong>
                {(["min_bpm", "max_bpm"] as const).map((key) => (
                  <input
                    key={key}
                    type="number"
                    inputMode="numeric"
                    min={30}
                    max={250}
                    step={1}
                    aria-label={`Z${index + 1} ${key === "min_bpm" ? copy.scores.zoneLower : copy.scores.zoneUpper}`}
                    aria-describedby="scores-zone-hint"
                    value={zone[key]}
                    onChange={(event) => {
                      setZones((previous) =>
                        previous.map((item, i) =>
                          i === index
                            ? { ...item, [key]: event.target.value }
                            : item,
                        ),
                      );
                      setError("");
                      setNotice("");
                    }}
                  />
                ))}
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              disabled={
                saving || zones.every((zone) => !zone.min_bpm && !zone.max_bpm)
              }
              onClick={() => {
                setZones(emptyZones());
                setError("");
                setNotice("");
              }}
            >
              {copy.scores.clearZones}
            </Button>
          </fieldset>
          <fieldset disabled={saving} className="scores-fields">
            <legend className="sr-only">{copy.scores.title}</legend>
            {fields.map(({ key, label, hint, unit, min, max, step }) => (
              <div className="score-field" key={key}>
                <label htmlFor={`score-${key}`}>{label}</label>
                <div className="score-input">
                  <input
                    id={`score-${key}`}
                    type="number"
                    inputMode={key === "vo2max" ? "decimal" : "numeric"}
                    min={min}
                    max={max}
                    step={step}
                    value={draft[key]}
                    aria-describedby={`score-${key}-hint score-${key}-unit`}
                    onChange={(event) => {
                      setDraft((previous) => ({
                        ...previous,
                        [key]: event.target.value,
                      }));
                      setError("");
                      setNotice("");
                    }}
                  />
                  <span id={`score-${key}-unit`}>{unit}</span>
                </div>
                <p id={`score-${key}-hint`}>{hint}</p>
              </div>
            ))}
          </fieldset>
          <p className="scores-clear-note">{copy.scores.clearNote}</p>
          {error && <ErrorNotice message={error} />}
          <div className="scores-actions">
            <Button type="submit" disabled={saving || !dirty}>
              {saving ? copy.scores.saving : copy.scores.save}
            </Button>
            <span role="status">{notice}</span>
          </div>
        </form>
      )}
    </Card>
  );
}
