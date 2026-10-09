export type TimerState = {
  id: string;
  name: string;
  sport: "Stretching" | "Meditation";
  routine: "stretch-v1" | "meditation-v1";
  started: string;
  total: number;
  elapsed: number;
  runningSince: number | null;
};
export function elapsedSeconds(timer: TimerState, now: number) {
  return Math.min(
    timer.total,
    timer.elapsed +
      (timer.runningSince === null
        ? 0
        : Math.max(0, now - timer.runningSince) / 1000),
  );
}
export function timerPosition(durations: number[], elapsed: number) {
  let offset = 0;
  for (let i = 0; i < durations.length; i++) {
    if (elapsed < offset + durations[i])
      return {
        index: i,
        remaining: Math.ceil(offset + durations[i] - elapsed),
      };
    offset += durations[i];
  }
  return { index: durations.length - 1, remaining: 0 };
}
export function clockTime(seconds: number) {
  const rounded = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}
