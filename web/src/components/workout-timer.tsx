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
import Link from "next/link";
import { api, errorMessage } from "@/lib/api";
import { elapsedSeconds, type TimerState } from "@/lib/workouts";
import {
  decodeDraft,
  encodeDraft,
  DRAFT_KEY,
  SOUND_KEY,
} from "@/lib/workout-draft";
import { WorkoutAudio } from "@/lib/workout-audio";
import { copy } from "@/lib/i18n";

type TimerContext = {
  timer: TimerState | null;
  elapsed: number;
  saving: boolean;
  saved: boolean;
  error: string;
  storageWarning: boolean;
  sound: boolean;
  audioReady: boolean;
  enableAudio: () => void;
  toggleSound: () => void;
  access: (state: "checking" | "in" | "out" | "error") => void;
  start: (name: string, sport: TimerState["sport"], total: number) => void;
  toggle: () => void;
  discard: () => void;
  save: () => Promise<void>;
};
const Context = createContext<TimerContext | null>(null);
export function useWorkoutTimer() {
  const value = useContext(Context);
  if (!value) throw new Error("Workout timer context missing");
  return value;
}
export function WorkoutTimerProvider({ children }: { children: ReactNode }) {
  const [timer, setTimer] = useState<TimerState | null>(null);
  const current = useRef<TimerState | null>(null);
  const stored = useRef<string | null>(null);
  const hydrated = useRef(false);
  const authorized = useRef(false);
  const [now, setNow] = useState(Date.now);
  const [saving, setSaving] = useState(false);
  const pendingSave = useRef<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [storageWarning, setStorageWarning] = useState(false);
  const [sound, setSound] = useState(true);
  const [audioReady, setAudioReady] = useState(false);
  const audio = useRef<WorkoutAudio | null>(null);
  const lastCue = useRef<{ id: string; elapsed: number; at: number } | null>(
    null,
  );

  const adopt = useCallback((next: TimerState | null) => {
    current.current = next;
    setTimer(next);
    setNow(Date.now());
    setSaved(false);
    setError("");
    lastCue.current = null;
  }, []);
  const read = useCallback(() => {
    try {
      return { raw: localStorage.getItem(DRAFT_KEY), available: true };
    } catch {
      setStorageWarning(true);
      return { raw: stored.current, available: false };
    }
  }, []);
  const write = useCallback((next: TimerState | null) => {
    try {
      const raw = next ? encodeDraft(next) : null;
      if (raw) localStorage.setItem(DRAFT_KEY, raw);
      else localStorage.removeItem(DRAFT_KEY);
      stored.current = raw;
      setStorageWarning(false);
    } catch {
      setStorageWarning(true);
    }
  }, []);
  const reconcile = useCallback(
    (raw: string | null) => {
      stored.current = raw;
      const next = decodeDraft(raw);
      // Invalid/unsupported drafts are never shown or sent to the API.
      if (raw && !next) write(null);
      adopt(next);
    },
    [adopt, write],
  );
  const access = useCallback(
    (state: "checking" | "in" | "out" | "error") => {
      authorized.current = state === "in";
      lastCue.current = null;
      if (state === "out") {
        write(null);
        adopt(null);
        hydrated.current = false;
      } else if (state === "in") {
        const result = read();
        if (
          !hydrated.current ||
          (result.available && result.raw !== stored.current)
        )
          reconcile(result.raw);
        hydrated.current = true;
      }
    },
    [adopt, read, reconcile, write],
  );

  // Read again under a same-origin lock: a queued click or late save response
  // must not resurrect a draft that another tab saved/discarded/replaced.
  const transact = useCallback(
    async (action: () => void) => {
      const expected = stored.current;
      const expectedId = current.current?.id;
      const run = () => {
        if (!authorized.current) return;
        const result = read();
        if (result.available && result.raw !== stored.current)
          reconcile(result.raw);
        if (result.raw !== expected || current.current?.id !== expectedId)
          return;
        action();
      };
      if (navigator.locks) await navigator.locks.request(DRAFT_KEY, run);
      else run();
    },
    [read, reconcile],
  );

  useEffect(() => {
    const readSound = () => {
      try {
        setSound(localStorage.getItem(SOUND_KEY) !== "off");
      } catch {
        /* Sound still works for this visit. */
      }
    };
    readSound();
    const sync = (event: StorageEvent) => {
      if (event.key === SOUND_KEY || event.key === null) readSound();
      if (
        authorized.current &&
        (event.key === DRAFT_KEY || event.key === null)
      ) {
        const result = read();
        if (result.available && result.raw !== stored.current)
          reconcile(result.raw);
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [read, reconcile]);
  useEffect(() => () => audio.current?.dispose(), []);
  const enableAudio = () => {
    audio.current ??= new WorkoutAudio(setAudioReady);
    void audio.current.unlock();
  };
  const elapsed = timer ? elapsedSeconds(timer, now) : 0;
  const running =
    !!timer && timer.runningSince !== null && elapsed < timer.total;
  useEffect(() => {
    if (!running) return;
    const tick = () => setNow(Date.now());
    const visibility = () => {
      lastCue.current = null;
      tick();
    };
    const interval = setInterval(tick, 250);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [running]);
  useEffect(() => {
    if (!timer) {
      lastCue.current = null;
      return;
    }
    const previous = lastCue.current;
    lastCue.current = { id: timer.id, elapsed, at: now };
    if (
      !authorized.current ||
      !sound ||
      !previous ||
      previous.id !== timer.id ||
      document.visibilityState !== "visible" ||
      now - previous.at > 1500 ||
      elapsed <= previous.elapsed
    )
      return;
    if (elapsed >= timer.total && previous.elapsed < timer.total)
      audio.current?.play("finish");
    else if (timer.sport === "Stretching") {
      const duration = timer.total / copy.workouts.stretches.length;
      if (
        Math.floor(elapsed / duration) > Math.floor(previous.elapsed / duration)
      )
        audio.current?.play("step");
    }
  }, [timer, elapsed, now, sound]);
  useEffect(() => {
    if (!timer || saved || !storageWarning) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [timer, saved, storageWarning]);
  useEffect(() => {
    if (!running || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null,
      disposed = false;
    const acquire = async () => {
      if (document.visibilityState !== "visible" || (lock && !lock.released))
        return;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (disposed) await next.release();
        else lock = next;
      } catch {
        /* The clock still catches up when the screen wakes. */
      }
    };
    void acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      disposed = true;
      void lock?.release();
      document.removeEventListener("visibilitychange", acquire);
    };
  }, [running]);
  const value: TimerContext = {
    timer,
    elapsed,
    saving,
    saved,
    error,
    storageWarning,
    sound,
    audioReady,
    access,
    enableAudio,
    toggleSound() {
      const next = !sound;
      setSound(next);
      if (next) enableAudio();
      try {
        localStorage.setItem(SOUND_KEY, next ? "on" : "off");
      } catch {
        /* The preference remains usable in memory. */
      }
    },
    start(name, sport, total) {
      if (sound) enableAudio();
      void transact(() => {
        if (current.current && !saved) return;
        const stamp = Date.now();
        const next: TimerState = {
          id: crypto.randomUUID(),
          name,
          sport,
          routine: sport === "Stretching" ? "stretch-v1" : "meditation-v1",
          total,
          started: new Date(stamp).toISOString(),
          elapsed: 0,
          runningSince: stamp,
        };
        write(next);
        adopt(next);
      });
    },
    toggle() {
      if (sound) enableAudio();
      void transact(() => {
        const t = current.current;
        if (!t || pendingSave.current === t.id) return;
        const stamp = Date.now();
        const elapsed = elapsedSeconds(t, stamp);
        if (elapsed >= t.total) return;
        const next = {
          ...t,
          elapsed,
          runningSince: t.runningSince === null ? stamp : null,
        };
        write(next);
        adopt(next);
      });
    },
    discard() {
      void transact(() => {
        write(null);
        adopt(null);
      });
    },
    async save() {
      let session: TimerState | null = null;
      await transact(() => {
        const t = current.current;
        if (
          !t ||
          pendingSave.current ||
          saved ||
          elapsedSeconds(t, Date.now()) < t.total
        )
          return;
        session = t;
        pendingSave.current = t.id;
        setSaving(true);
        setError("");
      });
      if (!session) return;
      const submitted = session as TimerState;
      try {
        await api("/api/sessions", {
          method: "POST",
          body: {
            id: submitted.id,
            name: submitted.name,
            sport: submitted.sport,
            start: submitted.started,
            duration: submitted.total,
          },
        });
        await transact(() => {
          if (current.current?.id !== submitted.id) return;
          write(null);
          setSaved(true);
        });
      } catch (e) {
        if (authorized.current && current.current?.id === submitted.id)
          setError(errorMessage(e));
      } finally {
        pendingSave.current = null;
        setSaving(false);
      }
    },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function TimerBanner() {
  const { timer, saved } = useWorkoutTimer();
  return timer && !saved ? (
    <Link className="timer-banner" href="/workouts">
      {copy.workouts.returnTimer}
    </Link>
  ) : null;
}
