"use client";
import { useTraining } from "./workspace";
import { Flag, ArrowUpRight, Check } from "lucide-react";
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
        description={
          compact ? copy.overview.goalDetail : copy.insights.goalDetail
        }
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
        <div className="goal-targets">
          {[
            {
              target: 1080,
              label: copy.insights.sub18,
              pace: copy.insights.goal18,
            },
            {
              target: 1020,
              label: copy.insights.sub17,
              pace: copy.insights.goal17,
            },
          ].map((goal, index) => (
            <div className="goal-target" key={goal.target}>
              <span className="goal-step">
                {benchmark && benchmark.seconds < goal.target ? (
                  <Check size={12} aria-hidden="true" />
                ) : (
                  `0${index + 1}`
                )}
              </span>
              <div>
                <strong>{goal.label}</strong>
                <span>{goal.pace}</span>
              </div>
              {benchmark && (
                <small>
                  {benchmark.seconds < goal.target
                    ? copy.insights.achieved
                    : `${raceTime(benchmark.seconds - goal.target)} ${copy.insights.remaining}`}
                </small>
              )}
            </div>
          ))}
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
            references={[
              { value: 1080, label: copy.insights.sub18 },
              { value: 1020, label: copy.insights.sub17 },
            ]}
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
