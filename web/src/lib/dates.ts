export const TIMEZONE = "Europe/Amsterdam";
export const LOCALE = "en-GB";
export function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function addDays(date: string, days: number) {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
export function startOfWeek(date: string) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}
export function shiftMonth(date: string, direction: number) {
  const result = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
  result.setUTCMonth(result.getUTCMonth() + direction);
  return result.toISOString().slice(0, 10);
}
export function calendarDays(date: string, mode: "week" | "month") {
  const start = startOfWeek(mode === "week" ? date : `${date.slice(0, 7)}-01`);
  const last = mode === "week" ? addDays(start, 6) : addDays(startOfWeek(addDays(shiftMonth(date, 1), -1)), 6);
  const days: string[] = [];
  for (let day = start; day <= last; day = addDays(day, 1)) days.push(day);
  return days;
}
export function dateLabel(date: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) {
  return new Intl.DateTimeFormat(LOCALE, { ...options, timeZone: "UTC" }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`));
}
export function timestampLabel(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(LOCALE, { timeZone: TIMEZONE, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date) : null;
}
