import { nonnegative, number, type Raw } from "./data";
export type IntervalMetrics = {
  seconds: number | null;
  distance: number | null;
  paceSecondsPerKm: number | null;
  zeroLength: boolean;
};
/** Recorded interval values; a recorded zero stays zero, a missing value stays null. */
export function intervalMetrics(row: Raw): IntervalMetrics {
  const moving = nonnegative(row.moving_time);
  const elapsed = nonnegative(row.elapsed_time);
  const seconds =
    moving !== null && moving > 0
      ? moving
      : elapsed !== null && elapsed > 0
        ? elapsed
        : moving === 0 || elapsed === 0
          ? 0
          : null;
  const distance = nonnegative(row.distance);
  const speed = number(row.average_speed);
  return {
    seconds,
    distance,
    paceSecondsPerKm:
      seconds !== null &&
      seconds > 0 &&
      distance !== null &&
      distance > 0 &&
      speed !== null &&
      speed > 0
        ? 1000 / speed
        : null,
    zeroLength: seconds === 0,
  };
}
