"use client";
import { Info } from "lucide-react";
import type { Zone } from "@/lib/data";
import { copy } from "@/lib/i18n";
import { duration } from "@/lib/format";
import { Empty } from "./ui";

const MAX_ZONE_COLOURS = 7;
const zoneClass = (i: number) => `zone-${Math.min(i + 1, MAX_ZONE_COLOURS)}`;
const share = (seconds: number, total: number) =>
  total ? (seconds / total) * 100 : 0;

/** "32 min" under an hour, otherwise the usual "1h 12m". */
function totalLabel(seconds: number) {
  const mins = Math.round(seconds / 60);
  return mins < 60
    ? `${mins} ${copy.insights.zoneTotalMinutes}`
    : duration(seconds);
}

/** Stacked distribution bar with the total and the easy (Z1–Z2) share. */
function ZoneSummary({ zones, total }: { zones: Zone[]; total: number }) {
  const easy = zones.slice(0, 2).reduce((sum, z) => sum + z.seconds, 0);
  return (
    <div className="zone-summary">
      <div className="zone-summary-labels">
        <span>
          {copy.insights.zoneDistribution} · {totalLabel(total)}{" "}
          {copy.insights.zoneTotal}
        </span>
        {total > 0 && (
          <span>
            {Math.round(share(easy, total))}% {copy.insights.zoneEasy}
          </span>
        )}
      </div>
      <div className="zone-stack" aria-hidden="true">
        {zones.map(
          (z, i) =>
            z.seconds > 0 && (
              <span
                key={z.zone}
                className={zoneClass(i)}
                style={{ flexBasis: `${share(z.seconds, total)}%` }}
              />
            ),
        )}
      </div>
    </div>
  );
}

export function ZoneBars({
  zones,
  ranges = [],
  empty = copy.insights.zoneEmpty,
  summary = false,
}: {
  zones: Zone[];
  /** Optional human range per zone, aligned with `zones`, e.g. "127–140". */
  ranges?: string[];
  empty?: string;
  /** Show the stacked distribution bar above the rows. */
  summary?: boolean;
}) {
  const total = zones.reduce((sum, z) => sum + z.seconds, 0);
  if (!zones.length) return <Empty title={empty} />;
  return (
    <>
      {summary && <ZoneSummary zones={zones} total={total} />}
      <div className="zone-bars">
        {zones.map((z, i) => (
          <div
            className={`zone-row${z.seconds > 0 ? "" : " is-empty"}`}
            key={z.zone}
          >
            <span className={`zone-dot ${zoneClass(i)}`} aria-hidden="true" />
            <span className="zone-label">
              <strong>{z.zone}</strong>
              {ranges[i] && <small className="zone-range">{ranges[i]}</small>}
            </span>
            <div className="zone-bar">
              <div className="bar-track">
                <div
                  className={`bar-value ${zoneClass(i)}`}
                  style={{ width: `${share(z.seconds, total)}%` }}
                />
              </div>
            </div>
            <strong className="zone-time">{duration(z.seconds)}</strong>
            <small className="zone-share">
              {Math.round(share(z.seconds, total))}%
            </small>
          </div>
        ))}
      </div>
    </>
  );
}

/** Footer note pointing at the Intervals.icu zone settings, with the detail on hover. */
export function ZoneSourceNote({ detail }: { detail: string }) {
  return (
    <span className="zone-source" title={detail}>
      {copy.insights.zoneFooter}
      <Info size={13} aria-hidden="true" />
    </span>
  );
}
