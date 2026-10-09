import type { TimerState } from "./workouts";
import { routineById, routineSeconds } from "./stretch-catalogue";

export const DRAFT_KEY = "reachy:workout-draft:v1";
export const SOUND_KEY = "reachy:workout-sound";

export function encodeDraft(timer: TimerState) {
  return JSON.stringify({ version: 1, timer });
}

// Legacy drafts (pre-catalogue) only ever ran one of two fixed durations.
function resolveRoutine(sport: unknown, routine: unknown, total: unknown) {
  if (sport === "Meditation")
    return routine === "meditation-v1" ? "meditation-v1" : null;
  if (sport !== "Stretching" || typeof routine !== "string") return null;
  if (routine === "stretch-v1") {
    if (total === 300) return "everyday-reset";
    if (total === 600) return "full-body-unwind";
    return null;
  }
  const r = routineById(routine);
  return r && routineSeconds(r) === total ? routine : null;
}

// Browser storage is untrusted. Keep only the bounded fields needed to resume.
export function decodeDraft(raw: string | null): TimerState | null {
  if (!raw) return null;
  try {
    const { version, timer: t } = JSON.parse(raw);
    if (
      version !== 1 ||
      !t ||
      typeof t.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        t.id,
      ) ||
      typeof t.name !== "string" ||
      !t.name.trim() ||
      t.name.length > 200 ||
      typeof t.started !== "string" ||
      !Number.isFinite(Date.parse(t.started)) ||
      !Number.isInteger(t.total) ||
      !(t.sport === "Meditation"
        ? t.total >= 60 && t.total <= 7200 && t.total % 60 === 0
        : t.sport === "Stretching") ||
      typeof t.elapsed !== "number" ||
      !Number.isFinite(t.elapsed) ||
      t.elapsed < 0 ||
      t.elapsed > t.total ||
      !(
        t.runningSince === null ||
        (typeof t.runningSince === "number" &&
          Number.isFinite(t.runningSince) &&
          t.runningSince >= Date.parse(t.started))
      )
    )
      return null;
    const routine = resolveRoutine(t.sport, t.routine, t.total);
    if (!routine) return null;
    return {
      id: t.id,
      name: t.name,
      sport: t.sport,
      routine,
      started: t.started,
      total: t.total,
      elapsed: t.elapsed,
      runningSince: t.runningSince,
    };
  } catch {
    return null;
  }
}
