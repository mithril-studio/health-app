import { copy } from "./i18n";
import { LOCALE } from "./dates";
export function metric(value: number | null | undefined, digits = 0) {
  return value == null || !Number.isFinite(value)
    ? copy.common.none
    : new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits }).format(
        value,
      );
}
export function duration(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return copy.common.none;
  const mins = Math.round(seconds / 60);
  return mins >= 60
    ? `${Math.floor(mins / 60)}${copy.common.hours} ${mins % 60}${copy.common.minutes}`
    : `${mins}${copy.common.minutes}`;
}
export function raceTime(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return copy.common.none;
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}
export function pace(secondsPerKm: number | null | undefined) {
  return secondsPerKm == null
    ? copy.common.none
    : `${raceTime(secondsPerKm)} ${copy.common.minKm}`;
}
export function plural(
  n: number | null | undefined,
  one: string,
  many: string,
) {
  return n === 1 ? one : many;
}
export function count(n: number | null | undefined, one: string, many: string) {
  return `${metric(n)} ${plural(n, one, many)}`;
}
/** Exact seconds as m:ss or h:mm:ss, for segments shorter than a minute. */
export function clock(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return copy.common.none;
  const total = Math.round(seconds);
  const s = String(total % 60).padStart(2, "0");
  const m = Math.floor(total / 60) % 60;
  return total >= 3600
    ? `${Math.floor(total / 3600)}:${String(m).padStart(2, "0")}:${s}`
    : `${m}:${s}`;
}
