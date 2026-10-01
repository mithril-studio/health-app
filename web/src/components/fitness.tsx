"use client";
import { fitnessSeries, type Dashboard } from "@/lib/data";
import { copy } from "@/lib/i18n";
import { metric } from "@/lib/format";
import { Card, CardHeading } from "./ui";
import { dailyRows, TrendChart } from "./charts";
export function FitnessCard({
  data,
  oldest,
  newest,
  overview = false,
}: {
  data: Dashboard;
  oldest: string;
  newest: string;
  overview?: boolean;
}) {
  const rows = fitnessSeries(data).filter(
    (r) => r.date >= oldest && r.date <= newest,
  );
  const last = rows.at(-1);
  return (
    <Card>
      <CardHeading
        title={overview ? copy.overview.fitness : copy.insights.fitness}
        description={
          overview ? copy.overview.fitnessDetail : copy.insights.fitnessDetail
        }
      />
      <div className="fitness-numbers">
        {[
          [copy.insights.ctl, last?.ctl],
          [copy.insights.atl, last?.atl],
          [copy.insights.form, last?.form],
        ].map(([label, value]) => (
          <div key={String(label)}>
            <span>{label}</span>
            <strong>{metric(value as number | undefined)}</strong>
          </div>
        ))}
      </div>
      <TrendChart
        rows={dailyRows(rows, ["ctl", "atl", "form"])}
        series={[
          { key: "ctl", name: copy.insights.ctl, area: true },
          { key: "atl", name: copy.insights.atl, tone: "secondary" },
          {
            key: "form",
            name: copy.insights.form,
            tone: "tertiary",
            dashed: true,
          },
        ]}
        title={copy.insights.fitness}
        empty={copy.insights.noFitness}
        height={overview ? 180 : 250}
      />
      <div className="card-footer">{copy.insights.fitnessNote}</div>
    </Card>
  );
}
