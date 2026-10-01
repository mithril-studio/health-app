import { copy } from "./i18n";
import { LOCALE } from "./dates";
export function metric(value: number | null | undefined, digits = 0) { return value == null || !Number.isFinite(value) ? copy.common.none : new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits }).format(value); }
export function duration(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return copy.common.none;
  const mins = Math.round(seconds / 60); return mins >= 60 ? `${Math.floor(mins / 60)}${copy.common.hours} ${mins % 60}${copy.common.minutes}` : `${mins}${copy.common.minutes}`;
}
export function raceTime(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return copy.common.none;
  const rounded = Math.round(seconds); return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}
export function pace(secondsPerKm: number | null | undefined) { return secondsPerKm == null ? copy.common.none : `${raceTime(secondsPerKm)} ${copy.common.minKm}`; }
