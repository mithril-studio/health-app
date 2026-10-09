"use client";
import { useEffect, useRef, useState } from "react";
import { Plus, Check, Play, Pause, Volume2, VolumeX } from "lucide-react";
import { copy } from "@/lib/i18n";
import { api, errorMessage } from "@/lib/api";
import { clockTime, timerPosition } from "@/lib/workouts";
import {
  stretchRoutines,
  routineById,
  routineSeconds,
  type Focus,
} from "@/lib/stretch-catalogue";
import { dateLabel } from "@/lib/dates";
import { duration } from "@/lib/format";
import {
  Button,
  Card,
  Badge,
  Modal,
  ErrorNotice,
  SportIcon,
} from "./ui";
import { useWorkoutTimer } from "./workout-timer";
import { useTraining } from "./workspace";
import { PageMenu, PageTabs, PagePanel } from "./page-menu";
import { ActivityDialog } from "./activity-dialog";
const w = copy.workouts;
const focusLabel: Record<Focus, string> = {
  full: w.focusFull,
  legs: w.focusLegs,
  hips: w.focusHips,
  back: w.focusBack,
  upper: w.focusUpper,
};
export function Workouts() {
  const timer = useWorkoutTimer();
  const { data, refresh } = useTraining();
  const [tab, setTab] = useState("stretch");
  const [focus, setFocus] = useState<"all" | Focus>("all");
  const [openRoutine, setOpenRoutine] = useState<string | null>(null);
  const [meditationMinutes, setMeditationMinutes] = useState(5);
  const [log, setLog] = useState(false);
  const [activityId, setActivityId] = useState<string | null>(null);
  const recent =
    data?.activities
      .filter((a) => a.raw.source === "app")
      .slice()
      .sort((a, b) =>
        String(b.raw.start_date_local).localeCompare(
          String(a.raw.start_date_local),
        ),
      )
      .slice(0, 8) ?? [];
  const routines = stretchRoutines.filter(
    (r) => focus === "all" || r.focus === focus,
  );
  const opened = openRoutine ? routineById(openRoutine) : undefined;
  useEffect(() => {
    if (timer.saved) void refresh();
  }, [timer.saved, refresh]);
  return (
    <div className="workouts-page">
      <PageMenu>
        <PageTabs
          prefix="workouts"
          label={copy.navigation.workouts}
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "stretch", label: w.tabStretch },
            { id: "meditate", label: w.tabMeditate },
            { id: "history", label: w.tabHistory },
          ]}
        />
        {tab === "stretch" && (
          <select
            aria-label={w.focusLabel}
            value={focus}
            onChange={(e) => setFocus(e.target.value as "all" | Focus)}
          >
            <option value="all">{w.focusAll}</option>
            <option value="full">{w.focusFull}</option>
            <option value="legs">{w.focusLegs}</option>
            <option value="hips">{w.focusHips}</option>
            <option value="back">{w.focusBack}</option>
            <option value="upper">{w.focusUpper}</option>
          </select>
        )}
        <div className="workouts-menu-actions">
          <Button
            variant="outline"
            size="icon"
            aria-label={w.soundCues}
            aria-pressed={timer.sound}
            onClick={timer.toggleSound}
          >
            {timer.sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </Button>
          {timer.sound && timer.timer && !timer.saved && !timer.audioReady && (
            <Button variant="ghost" size="sm" onClick={timer.enableAudio}>
              {w.enableSound}
            </Button>
          )}
          <Button size="sm" onClick={() => setLog(true)}>
            <Plus size={15} />
            {w.log}
          </Button>
        </div>
      </PageMenu>
      {timer.storageWarning && (
        <p role="status" className="workout-caption">
          {w.storageWarning}
        </p>
      )}
      <PagePanel prefix="workouts" id="stretch" value={tab}>
        {timer.timer ? (
          tab === "stretch" && <TimerPlayer />
        ) : (
          <div className="stretch-catalogue">
            {routines.map((r) => (
              <button
                key={r.id}
                type="button"
                className="routine-card"
                onClick={() => setOpenRoutine(r.id)}
              >
                <strong>{r.name}</strong>
                <span>
                  {Math.round(routineSeconds(r) / 60)} {w.minute} ·{" "}
                  {r.steps.length} {w.stretchCount}
                </span>
                <small>
                  {focusLabel[r.focus]} · {r.when}
                </small>
              </button>
            ))}
          </div>
        )}
      </PagePanel>
      <PagePanel prefix="workouts" id="meditate" value={tab}>
        {timer.timer ? (
          tab === "meditate" && <TimerPlayer />
        ) : (
          <Card className="workout-option">
            <div className="meditation-presets">
              {[3, 5, 10, 15, 20].map((mins) => (
                <button
                  key={mins}
                  aria-pressed={meditationMinutes === mins}
                  onClick={() => setMeditationMinutes(mins)}
                >
                  {mins}
                  <small>{w.minute}</small>
                </button>
              ))}
            </div>
            <label className="workout-duration">
              {w.minutes}
              <input
                type="number"
                min="1"
                max="120"
                value={meditationMinutes || ""}
                onChange={(e) => setMeditationMinutes(Number(e.target.value))}
              />
            </label>
            <Button
              disabled={
                !Number.isInteger(meditationMinutes) ||
                meditationMinutes < 1 ||
                meditationMinutes > 120
              }
              onClick={() =>
                timer.start(
                  w.meditation,
                  "Meditation",
                  meditationMinutes * 60,
                  "meditation-v1",
                )
              }
            >
              <Play size={16} />
              {w.startMeditation}
            </Button>
          </Card>
        )}
      </PagePanel>
      <PagePanel prefix="workouts" id="history" value={tab}>
        <Card>
          {recent.length ? (
            <ul className="workout-history">
              {recent.map((a) => (
                <li key={a.id}>
                  <button onClick={() => setActivityId(a.id)}>
                    <SportIcon sport={a.sport} />
                    <span>
                      <strong>{a.name}</strong>
                      <small>
                        {dateLabel(a.date)} · {copy.sports[a.sport]}
                      </small>
                    </span>
                    <span>{duration(a.duration)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="workout-caption">{w.empty}</p>
          )}
        </Card>
      </PagePanel>
      <Modal
        open={!!opened}
        onClose={() => setOpenRoutine(null)}
        title={opened?.name ?? ""}
        description={opened?.when ?? ""}
      >
        {opened && (
          <>
            <ol className="stretch-sequence">
              {opened.steps.map((s, i) => (
                <li key={`${i}-${s.name}`}>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <strong>{s.name}</strong>
                  <small>{clockTime(s.seconds)}</small>
                </li>
              ))}
            </ol>
            <div className="timer-actions">
              <Button
                onClick={() => {
                  timer.start(
                    opened.name,
                    "Stretching",
                    routineSeconds(opened),
                    opened.id,
                  );
                  setOpenRoutine(null);
                }}
              >
                <Play size={16} />
                {w.startRoutine}
              </Button>
            </div>
          </>
        )}
      </Modal>
      {log && <LogWorkout open={log} onClose={() => setLog(false)} />}
      <ActivityDialog id={activityId} onClose={() => setActivityId(null)} />
    </div>
  );
}
function TimerPlayer() {
  const { timer, elapsed, saving, saved, error, toggle, discard, save } =
    useWorkoutTimer();
  const [confirm, setConfirm] = useState(false);
  if (!timer) return null;
  const done = elapsed >= timer.total,
    stretching = timer.sport === "Stretching";
  const routine = stretching ? routineById(timer.routine) : undefined;
  const durations = routine ? routine.steps.map((s) => s.seconds) : [];
  const position = routine ? timerPosition(durations, elapsed) : null;
  const step = routine && position ? routine.steps[position.index] : null;
  const paused = timer.runningSince === null;
  return (
    <Card className="timer-player">
      <div className="timer-main">
        <Badge accent>
          {saved ? w.saved : done ? w.finished : paused ? w.paused : w.running}
        </Badge>
        <h2>{timer.name}</h2>
        <div
          className="timer-dial"
          style={
            {
              "--progress": `${(elapsed / timer.total) * 360}deg`,
            } as React.CSSProperties
          }
        >
          <div>
            <span role="timer" aria-label={w.remaining}>
              {clockTime(
                done
                  ? 0
                  : position
                    ? position.remaining
                    : timer.total - elapsed,
              )}
            </span>
            <small>
              {position && !done
                ? `${w.step} ${position.index + 1} / ${routine!.steps.length}`
                : w.remaining}
            </small>
          </div>
        </div>
        <div className="timer-instruction" aria-live="polite">
          <h3>{done ? w.finished : step ? step.name : w.meditation}</h3>
          <p>
            {done
              ? saved
                ? w.saved
                : w.readyToSave
              : step
                ? step.hint
                : w.meditationDetail}
          </p>
        </div>
        <div className="timer-actions">
          {done ? (
            saved ? (
              <Button onClick={discard}>
                <Check size={16} />
                {w.another}
              </Button>
            ) : (
              <Button disabled={saving} onClick={() => void save()}>
                {saving ? w.saving : w.save}
              </Button>
            )
          ) : (
            <Button onClick={toggle}>
              {paused ? <Play size={16} /> : <Pause size={16} />}
              {paused ? w.resume : w.pause}
            </Button>
          )}
          {!saved && (
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => setConfirm(true)}
            >
              {w.discard}
            </Button>
          )}
        </div>
        {error && <ErrorNotice message={error} />}
      </div>
      {routine && position && (
        <ol className="stretch-sequence">
          {routine.steps.map((s, i) => (
            <li
              key={`${i}-${s.name}`}
              className={i === position.index && !done ? "current" : ""}
              aria-current={i === position.index && !done ? "step" : undefined}
            >
              <span>
                {done || i < position.index ? (
                  <Check size={15} />
                ) : (
                  String(i + 1).padStart(2, "0")
                )}
              </span>
              <strong>{s.name}</strong>
              <small>{clockTime(s.seconds)}</small>
            </li>
          ))}
        </ol>
      )}
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={w.discardTitle}
        description={w.discardDetail}
      >
        <div className="timer-actions">
          <Button variant="outline" onClick={() => setConfirm(false)}>
            {copy.common.cancel}
          </Button>
          <Button variant="destructive" onClick={discard}>
            {w.discard}
          </Button>
        </div>
      </Modal>
    </Card>
  );
}
function localDateTime() {
  const date = new Date(Date.now() - 30 * 60000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function LogWorkout({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { refresh } = useTraining();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (open) {
      pending.current = null;
      setError("");
    }
  }, [open]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    if (!pending.current) {
      const start = new Date(String(fields.get("start"))),
        seconds = Number(fields.get("duration")) * 60;
      if (
        !Number.isFinite(start.getTime()) ||
        start.getTime() + seconds * 1000 > Date.now()
      ) {
        setError(w.invalidTime);
        return;
      }
      pending.current = {
        id: crypto.randomUUID(),
        name: fields.get("name"),
        sport: fields.get("sport"),
        start: start.toISOString(),
        duration: seconds,
        notes: fields.get("notes"),
      };
    }
    setBusy(true);
    setError("");
    try {
      await api("/api/sessions", { method: "POST", body: pending.current });
      await refresh();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={w.logTitle}
      description={w.logDescription}
    >
      <form className="workout-form" onSubmit={submit}>
        <fieldset disabled={busy || !!pending.current}>
          <label>
            {w.name}
            <input name="name" required maxLength={200} />
          </label>
          <label htmlFor="workout-sport">
            {w.sport}
            <select id="workout-sport" name="sport">
              {w.sports.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {w.start}
            <input
              name="start"
              type="datetime-local"
              defaultValue={localDateTime()}
              required
            />
          </label>
          <label>
            {w.duration}
            <input
              name="duration"
              type="number"
              min="1"
              max="1440"
              step="1"
              defaultValue="30"
              required
            />
          </label>
          <label>
            {w.notes}
            <textarea name="notes" maxLength={2000} rows={3} />
          </label>
        </fieldset>
        {error && <ErrorNotice message={error} />}
        <Button type="submit" disabled={busy}>
          {busy ? w.saving : pending.current ? copy.common.retry : w.save}
        </Button>
      </form>
    </Modal>
  );
}
