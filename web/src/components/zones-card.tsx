"use client";
import { useState } from "react";
import { weeklyZones, type Dashboard, type Sport } from "@/lib/data";
import { copy } from "@/lib/i18n";
import { Card, CardHeading } from "./ui";
import { ZoneBars } from "./zone-bars";

export function ZonesCard({ data, week }: { data: Dashboard; week: string }) {
  const [kind, setKind] = useState<"hr" | "pace" | "power">("hr");
  const [sport, setSport] = useState<Sport | "all">("all");
  const result = weeklyZones(data.activities, week, kind, sport);
  return (
    <Card>
      <CardHeading title={copy.insights.zones} />
      <div className="card-body">
        <div className="zone-controls">
          <div className="segmented">
            {(["hr", "pace", "power"] as const).map((key) => (
              <button
                key={key}
                aria-pressed={kind === key}
                onClick={() => setKind(key)}
              >
                {copy.common[key]}
              </button>
            ))}
          </div>
          <select
            aria-label={copy.common.sport}
            value={sport}
            onChange={(e) => setSport(e.target.value as Sport | "all")}
          >
            <option value="all">{copy.common.allSports}</option>
            {Object.entries(copy.sports).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <ZoneBars zones={result.zones} />
        <p className="coverage-note">
          {result.measured} / {result.total} {copy.insights.zoneCoverage}
        </p>
      </div>
      <div className="card-footer">{copy.insights.zoneNote}</div>
    </Card>
  );
}
