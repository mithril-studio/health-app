"use client";
import { useState } from "react";
import { weeklyZones, zoneRanges, type Dashboard } from "@/lib/data";
import { plural } from "@/lib/format";
import { copy } from "@/lib/i18n";
import { Card, CardHeading } from "./ui";
import { ZoneBars } from "./zone-bars";
import { RestrictedNote } from "./source-notice";

type ZoneSport = "run" | "ride";
type Metric = "hr" | "pace" | "power";
// Pace zones only make sense for running and power zones for cycling.
const METRICS: Record<ZoneSport, Metric[]> = {
  run: ["hr", "pace"],
  ride: ["hr", "power"],
};
const EMPTY: Record<Metric, string> = {
  hr: copy.insights.zoneEmptyHr,
  pace: copy.insights.zoneEmptyPace,
  power: copy.insights.zoneEmptyPower,
};

export function ZonesCard({ data, week }: { data: Dashboard; week: string }) {
  const [sport, setSport] = useState<ZoneSport>("run");
  const [choice, setChoice] = useState<Metric>("hr");
  const kind = METRICS[sport].includes(choice) ? choice : "hr";
  const result = weeklyZones(data.activities, week, kind, sport);
  const mixed = kind === "hr" && result.measured > 1 && !result.limits.length;
  return (
    <Card>
      <CardHeading title={copy.insights.zones} />
      <div className="card-body">
        <div className="zone-controls">
          <div className="segmented" aria-label={copy.common.sport}>
            {(["run", "ride"] as const).map((key) => (
              <button
                key={key}
                aria-pressed={sport === key}
                onClick={() => setSport(key)}
              >
                {copy.sports[key]}
              </button>
            ))}
          </div>
          <div className="segmented">
            {METRICS[sport].map((key) => (
              <button
                key={key}
                aria-pressed={kind === key}
                onClick={() => setChoice(key)}
              >
                {copy.common[key]}
              </button>
            ))}
          </div>
        </div>
        <ZoneBars
          zones={result.zones}
          ranges={zoneRanges(result.limits, copy.common.bpm)}
          empty={EMPTY[kind]}
        />
        <p className="coverage-note">
          {result.measured} / {result.total}{" "}
          {plural(
            result.total,
            copy.insights.zoneCoverageOne,
            copy.insights.zoneCoverage,
          )}
          {mixed && ` · ${copy.insights.zoneMixed}`}
        </p>
        <RestrictedNote
          restricted={result.restricted}
          one={copy.insights.restrictedZonesOne}
          many={copy.insights.restrictedZones}
        />
      </div>
      <div className="card-footer">{copy.insights.zoneNote}</div>
    </Card>
  );
}
