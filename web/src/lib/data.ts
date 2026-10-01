import { addDays, startOfWeek, validDate } from "./dates";
export type Raw = Record<string, unknown>;
export const record = (value: unknown): Raw => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Raw : {};
export const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const text = (value: unknown): string => typeof value === "string" ? value : "";
export function number(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
export function nonnegative(value: unknown) { const n = number(value); return n !== null && n >= 0 ? n : null; }
export type Sport = "run" | "ride" | "football" | "gym" | "swim" | "other";
export function sportOf(type: string): Sport {
  if (/run/i.test(type)) return "run";
  if (/ride|cycl/i.test(type)) return "ride";
  if (/soccer|football/i.test(type)) return "football";
  if (/weight|strength|gym|workout/i.test(type)) return "gym";
  if (/swim/i.test(type)) return "swim";
  return "other";
}
export type Zone = { zone: string; seconds: number };
export function zoneTimes(value: unknown): Zone[] {
  return array(value).flatMap((item, i) => {
    const row = record(item);
    const seconds = nonnegative(typeof item === "object" && item !== null ? row.secs : item);
    return seconds === null ? [] : [{ zone: text(row.id) || `Z${i + 1}`, seconds }];
  });
}
export type Activity = {
  id: string; name: string; type: string; sport: Sport; date: string;
  duration: number | null; elapsed: number | null; distance: number | null;
  load: number | null; hr: number | null; watts: number | null;
  zones: Record<"hr" | "pace" | "power", Zone[]>; raw: Raw;
};
export type PlannedEvent = {
  id: string; name: string; type: string; sport: Sport; date: string;
  duration: number | null; description: string; category: string;
  activityId: string | null; raw: Raw;
};
const identifier = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "";
const dateOf = (value: unknown) => { const date = text(value).slice(0, 10); return validDate(date) ? date : ""; };
export function normalizeActivity(value: unknown): Activity | null {
  const r = record(value); const id = identifier(r.id); const date = dateOf(r.start_date_local);
  if (!id || !date) return null;
  const type = text(r.type);
  return { id, name: text(r.name), type, sport: sportOf(type), date,
    duration: nonnegative(r.moving_time), elapsed: nonnegative(r.elapsed_time), distance: nonnegative(r.icu_distance ?? r.distance),
    load: nonnegative(r.icu_training_load), hr: nonnegative(r.average_heartrate), watts: nonnegative(r.icu_average_watts),
    zones: { hr: zoneTimes(r.hr_zone_times), pace: zoneTimes(r.pace_zone_times), power: zoneTimes(r.icu_zone_times) }, raw: r };
}
export type Wellness = { date: string; hrv: number | null; sleep: number | null; restingHR: number | null; ctl: number | null; atl: number | null };
export type Fitness = { date: string; ctl: number | null; atl: number | null; form: number | null };
export type Dashboard = {
  activities: Activity[]; events: PlannedEvent[]; wellness: Wellness[]; fitness: Fitness[];
  settings: unknown; sync: { lastSuccess: string | null; error: string | null }; insights: Raw;
};
export function normalizeDashboard(value: unknown): Dashboard {
  const root = record(value);
  if (!Array.isArray(root.activities)) throw new Error("Invalid dashboard response");
  const activities = root.activities.map(normalizeActivity).filter((a): a is Activity => a !== null).sort((a, b) => a.date.localeCompare(b.date));
  const events = array(root.events).flatMap(value => {
    const r = record(value); const id = identifier(r.id); const date = dateOf(r.start_date_local); const type = text(r.type);
    if (!id || !date) return [];
    const paired = identifier(r.paired_activity_id) || activities.find(a => identifier(a.raw.paired_event_id) === id)?.id || null;
    return [{ id, date, name: text(r.name), type, sport: sportOf(type), duration: nonnegative(r.moving_time), description: text(r.description), category: text(r.category), activityId: paired, raw: r }];
  });
  const wellness = array(root.wellness).flatMap(value => {
    const r = record(value); const date = dateOf(r.id ?? r.date); if (!date) return [];
    return [{ date, hrv: nonnegative(r.hrv), sleep: nonnegative(r.sleepSecs), restingHR: nonnegative(r.restingHR), ctl: number(r.ctl), atl: number(r.atl) }];
  }).sort((a,b) => a.date.localeCompare(b.date));
  const fitness = array(root.fitness).flatMap(value => {
    const r = record(value); const date = dateOf(r.date ?? r.id); if (!date) return [];
    return [{ date, ctl: number(r.ctl), atl: number(r.atl), form: number(r.form) }];
  });
  const sync = record(root.sync);
  return { activities, events, wellness, fitness, settings: root.settings, insights: record(root.insights), sync: { lastSuccess: text(sync.last_success) || null, error: text(sync.error) || null } };
}
export function fitnessSeries(data: Dashboard): Fitness[] {
  const rows = new Map<string, Fitness>();
  for (const row of data.wellness) if (row.ctl !== null || row.atl !== null) rows.set(row.date, { date: row.date, ctl: row.ctl, atl: row.atl, form: null });
  for (const row of data.fitness) rows.set(row.date, row);
  return [...rows.values()].map(row => ({ ...row, form: row.form ?? (row.ctl !== null && row.atl !== null ? row.ctl - row.atl : null) })).sort((a,b) => a.date.localeCompare(b.date));
}
export function sumKnown(values: (number | null)[]): number | null {
  const known = values.filter((n): n is number => n !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}
export function weeklyLoad(activities: Activity[], week: string) {
  const rows = activities.filter(a => a.date >= week && a.date < addDays(week, 7));
  const sports = [...new Set(rows.map(a => a.sport))];
  return sports.map(sport => {
    const subset = rows.filter(a => a.sport === sport);
    return { sport, load: sumKnown(subset.map(a => a.load)), missing: subset.filter(a => a.load === null).length, count: subset.length };
  });
}
export function weeklyZones(activities: Activity[], week: string, metric: "hr" | "pace" | "power", sport: Sport | "all") {
  const rows = activities.filter(a => a.date >= week && a.date < addDays(week, 7) && (sport === "all" || a.sport === sport));
  const sums = new Map<string, number>();
  for (const a of rows) for (const z of a.zones[metric]) sums.set(z.zone, (sums.get(z.zone) ?? 0) + z.seconds);
  return { zones: [...sums].map(([zone, seconds]) => ({ zone, seconds })).sort((a,b) => a.zone.localeCompare(b.zone, undefined, { numeric: true })), measured: rows.filter(a => a.zones[metric].length).length, total: rows.length };
}
export function goalResults(activities: Activity[]) {
  // A small GPS tolerance identifies recorded ~5 km runs. Never scale a duration to 5 km.
  return activities.filter(a => a.sport === "run" && a.distance !== null && a.distance >= 4950 && a.distance <= 5050 && a.elapsed !== null && a.elapsed > 0)
    .map(a => ({ id: a.id, date: a.date, seconds: a.elapsed!, distance: a.distance!, name: a.name }));
}
export function thresholdHistory(activities: Activity[]) {
  return activities.flatMap(a => {
    const speed = number(a.raw.icu_threshold_pace);
    return a.sport === "run" && speed !== null && speed > 0 ? [{ date: a.date, pace: 1000 / speed }] : [];
  });
}
export type CurvePoint = { x: number; value: number };
export function normalizeCurves(value: unknown, sport: "Run" | "Ride"): CurvePoint[] {
  const root = record(value);
  const curves = Array.isArray(value) ? value : array(root.list ?? root.curves);
  const curve = record(curves[0] ?? value);
  const secs = array(curve.secs ?? root.secs);
  const xs = sport === "Run" ? array(curve.distances ?? root.distances) : secs;
  const ys = sport === "Run" ? secs : array(curve.watts ?? curve.values);
  return xs.flatMap((x, i) => {
    const xValue = number(x); const yValue = number(ys[i]);
    if (xValue === null || yValue === null || xValue <= 0 || yValue <= 0) return [];
    return [{ x: xValue, value: sport === "Run" ? yValue * 1000 / xValue : yValue }];
  }).sort((a,b) => a.x - b.x);
}
export function recentWeeks(date: string, count = 8) { const week = startOfWeek(date); return Array.from({ length: count }, (_, i) => addDays(week, (i - count + 1) * 7)); }
