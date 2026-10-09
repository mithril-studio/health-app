"use client";
import { useEffect, useState } from "react";
import { api, ApiError, errorMessage } from "@/lib/api";
import type { AthleteProfile as Profile } from "@/lib/athlete";
import { athleteCopy as c } from "@/lib/athlete-copy";
import { timestampLabel } from "@/lib/dates";
import { Button, Card, CardHeading, ErrorNotice, Skeleton } from "./ui";
import { TextField } from "./athlete-text-field";

export function AthleteProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<Profile>("/api/athlete-profile", { signal: controller.signal })
      .then((value) => {
        setProfile(value);
        setConflict(false);
        setSaved(false);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [version]);
  function change(field: keyof Profile, value: string | null) {
    setProfile((p) => p && { ...p, [field]: value });
    setSaved(false);
  }
  async function save() {
    if (!profile || busy || conflict) return;
    setBusy(true);
    setError("");
    setSaved(false);
    const { updated_at: _timestamp, ...body } = profile;
    try {
      setProfile(
        await api<Profile>("/api/athlete-profile", { method: "POST", body }),
      );
      setSaved(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setConflict(true);
        setError(c.conflict);
      } else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="athlete-card">
      <CardHeading title={c.confirmed} description={c.profileNote} />
      {error && (
        <ErrorNotice
          message={error}
          retry={!profile ? () => setVersion((v) => v + 1) : undefined}
        />
      )}
      {conflict && (
        <Button variant="outline" onClick={() => setVersion((v) => v + 1)}>
          {c.reload}
        </Button>
      )}
      {loading ? (
        <Skeleton compact />
      ) : (
        profile && (
          <form
            className="athlete-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <fieldset
              className="athlete-profile-fields"
              disabled={busy || conflict}
            >
              <TextField
                id="goals"
                label={c.goals}
                value={profile.goals}
                onChange={(value) => change("goals", value)}
              />
              <div className="athlete-field">
                <label htmlFor="target-date">{c.targetDate}</label>
                <input
                  id="target-date"
                  type="date"
                  value={profile.target_date ?? ""}
                  onChange={(e) =>
                    change("target_date", e.target.value || null)
                  }
                />
              </div>
              <TextField
                id="background"
                label={c.background}
                value={profile.background}
                onChange={(value) => change("background", value)}
              />
              <TextField
                id="availability"
                label={c.availability}
                value={profile.availability}
                onChange={(value) => change("availability", value)}
              />
              <TextField
                id="other-sports"
                label={c.otherSports}
                value={profile.other_sports}
                onChange={(value) => change("other_sports", value)}
              />
              <TextField
                id="equipment"
                label={c.equipment}
                value={profile.equipment}
                onChange={(value) => change("equipment", value)}
              />
              <TextField
                id="constraints"
                label={c.constraints}
                value={profile.constraints}
                onChange={(value) => change("constraints", value)}
              />
              <TextField
                id="preferences"
                label={c.preferences}
                value={profile.preferences}
                onChange={(value) => change("preferences", value)}
              />
              <TextField
                id="plan-context"
                label={c.planContext}
                value={profile.plan_context}
                onChange={(value) => change("plan_context", value)}
              />
            </fieldset>
            <div className="athlete-actions">
              <Button type="submit" disabled={busy || conflict}>
                {busy ? c.saving : c.save}
              </Button>
              <span role="status">{saved ? c.saved : ""}</span>
            </div>
            <p className="athlete-caption">
              {profile.updated_at ? (
                <>
                  {c.updated}:{" "}
                  <time dateTime={profile.updated_at}>
                    {timestampLabel(profile.updated_at)}
                  </time>
                </>
              ) : (
                c.notSaved
              )}
            </p>
          </form>
        )
      )}
    </Card>
  );
}
