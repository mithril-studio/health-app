"use client";
import type { Zone } from "@/lib/data";
import { copy } from "@/lib/i18n";
import { duration } from "@/lib/format";
import { Empty } from "./ui";
export function ZoneBars({
  zones,
  ranges = [],
  empty = copy.insights.zoneEmpty,
}: {
  zones: Zone[];
  /** Optional human range per zone, aligned with `zones`, e.g. "127–140 bpm". */
  ranges?: string[];
  empty?: string;
}) {
  const total = zones.reduce((sum, z) => sum + z.seconds, 0);
  if (!zones.length) return <Empty title={empty} />;
  return (
    <div className="zone-bars">
      {zones.map((z, i) => (
        <div className="zone-row" key={z.zone}>
          <span>
            {z.zone}
            {ranges[i] && <small className="zone-range">{ranges[i]}</small>}
          </span>
          <div className="bar-track">
            <div
              className={`bar-value zone-${Math.min(i, 5)}`}
              style={{ width: `${total ? (z.seconds / total) * 100 : 0}%` }}
            />
          </div>
          <span>{duration(z.seconds)}</span>
          <small>{total ? Math.round((z.seconds / total) * 100) : 0}%</small>
        </div>
      ))}
    </div>
  );
}
