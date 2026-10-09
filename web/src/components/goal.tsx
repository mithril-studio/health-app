"use client";
import { useTraining } from "./workspace";
import { Flag, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { goalResults, thresholdHistory, type Dashboard } from "@/lib/data";
import { copy } from "@/lib/i18n";
import { metric, raceTime, pace } from "@/lib/format";
import { Card, CardHeading } from "./ui";
import { TrendChart } from "./charts";
export function GoalCard({
  data,
  compact = false,
}: {
  data: Dashboard;
  compact?: boolean;
}) {
  const { runCurve } = useTraining();
  const results = goalResults(data.activities);
  const best = results.length
    ? results.reduce((a, b) => (a.seconds < b.seconds ? a : b))
    : null;
  const fromCurve =
    !!runCurve.best && (!best || runCurve.best.seconds < best.seconds);
  const benchmark = fromCurve ? runCurve.best : best;
  return (
    <Card className="goal-card">
      <CardHeading
        title={compact ? copy.overview.goalTitle : copy.insights.goal}
        action={<Flag size={17} strokeWidth={1.5} aria-hidden="true" />}
      />
      <div className="goal-body">
        <div className="goal-best">
          <span>{fromCurve ? copy.sources.goalCurve : copy.insights.best}</span>
          <strong>
            {benchmark ? raceTime(benchmark.seconds) : copy.common.none}
          </strong>
          {fromCurve ? (
            <small>{copy.sources.goalCurveWindow}</small>
          ) : (
            best && (
              <small>
                {metric(best.distance / 1000, 2)} {copy.common.km} · {best.date}
              </small>
            )
          )}
        </div>

      </div>
      {!benchmark && !runCurve.loading && (
        <p className="goal-empty">
          {compact ? copy.insights.noGoal : copy.insights.noGoalDetail}
        </p>
      )}
      {!compact && (
        <>
          {runCurve.error && (
            <p className="goal-empty">{copy.sources.curveUnavailable}</p>
          )}
          <TrendChart
            rows={results.map((r) => ({ date: r.date, seconds: r.seconds }))}
            series={[{ key: "seconds", name: copy.insights.goalHistory }]}
            title={copy.insights.goalHistory}
            empty={copy.insights.noWholeRun}
            yFormat={raceTime}
            height={220}
          />
          <div className="threshold-section">
            <h3>{copy.insights.threshold}</h3>
            <TrendChart
              rows={thresholdHistory(data.activities)}
              series={[{ key: "pace", name: copy.insights.threshold }]}
              title={copy.insights.threshold}
              empty={copy.insights.noThreshold}
              yFormat={pace}
              height={170}
            />
          </div>
        </>
      )}
      <div className="card-footer">
        {compact ? (
          <Link className="inline-link" href="/insights">
            {copy.common.viewDetails}
            <ArrowUpRight size={12} aria-hidden="true" />
          </Link>
        ) : (
          `${fromCurve ? copy.sources.goalCurveNote + " " : ""}${copy.insights.goalNote}`
        )}
      </div>
    </Card>
  );
}
