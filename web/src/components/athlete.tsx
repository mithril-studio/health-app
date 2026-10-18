"use client";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Circle, Compass, Flag, Target, UserRound } from "lucide-react";
import { accountabilitySummary, weeklyAccountability } from "@/lib/athlete";
import { addDays, dateLabel } from "@/lib/dates";
import { goalResults } from "@/lib/data";
import { duration, metric } from "@/lib/format";
import { copy } from "@/lib/i18n";
import { DataGate, useTraining } from "./workspace";
import { Badge, Card, CardHeading, cn } from "./ui";
import { PageMenu, PagePanel, PageTabs } from "./page-menu";

const tabs = [
  { id: "athlete", label: copy.athlete.tabs.athlete },
  { id: "coach", label: copy.athlete.tabs.coach },
] as const;

type Tab = (typeof tabs)[number]["id"];
type CoachId = (typeof copy.athlete.coaches)[number]["id"];

function bestRecordedFiveK(data: ReturnType<typeof useTraining>["data"], curveSeconds: number | null) {
  const recorded = data ? goalResults(data.activities).map((result) => result.seconds) : [];
  const seconds = [curveSeconds, ...recorded].filter((value): value is number => value !== null);
  return seconds.length ? Math.min(...seconds) : null;
}

function targetGap(seconds: number | null, target: number) {
  if (seconds === null) return copy.insights.unavailable;
  if (seconds <= target) return copy.insights.achieved;
  return `${duration(seconds - target)} ${copy.insights.remaining}`;
}

export function Athlete() {
  const { data, now, runCurve } = useTraining();
  const [tab, setTab] = useState<Tab>("athlete");
  const [selectedCoach, setSelectedCoach] = useState<CoachId>(copy.athlete.coaches[0].id);
  useEffect(() => {
    try {
      const stored = localStorage.getItem("coach_voice");
      if (stored && copy.athlete.coaches.some((coach) => coach.id === stored)) {
        setSelectedCoach(stored as CoachId);
      }
    } catch {
      /* Local preference only. */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("coach_voice", selectedCoach);
    } catch {
      /* Local preference only. */
    }
  }, [selectedCoach]);
  const weeks = useMemo(() => (data ? weeklyAccountability(data, now, 12) : []), [data, now]);
  const summary = accountabilitySummary(weeks);
  const best = bestRecordedFiveK(data, runCurve.best?.seconds ?? null);
  const coach = copy.athlete.coaches.find((item) => item.id === selectedCoach) ?? copy.athlete.coaches[0];
  return (
    <>
      <PageMenu>
        <PageTabs
          prefix="athlete"
          label={copy.navigation.athlete}
          tabs={tabs}
          value={tab}
          onChange={(value) => setTab(value as Tab)}
        />
      </PageMenu>
      <DataGate>
        {data && (
          <>
            <PagePanel prefix="athlete" id="athlete" value={tab}>
              <div className="athlete-hero section-gap">
                <div>
                  <span className="eyebrow">{copy.athlete.title}</span>
                  <h2>{copy.athlete.goalTitle}</h2>
                  <p>{copy.athlete.goalDescription}</p>
                </div>
                <div className="athlete-goal-metrics" aria-label={copy.athlete.goalTitle}>
                  <div>
                    <span>{copy.athlete.currentGoal}</span>
                    <strong>{copy.athlete.currentGoalValue}</strong>
                    <small>{targetGap(best, 18 * 60)}</small>
                  </div>
                  <div>
                    <span>{copy.athlete.stretchGoal}</span>
                    <strong>{copy.athlete.stretchGoalValue}</strong>
                    <small>{targetGap(best, 17 * 60)}</small>
                  </div>
                </div>
              </div>
              <div className="card-grid equal">
                <Card>
                  <CardHeading title={copy.athlete.visionTitle} description={copy.athlete.vision} />
                  <div className="card-body athlete-vision-list">
                    <div>
                      <Target size={18} aria-hidden="true" />
                      <span>{copy.insights.best}</span>
                      <strong>{best ? duration(best) : copy.insights.noGoal}</strong>
                    </div>
                    <div>
                      <Compass size={18} aria-hidden="true" />
                      <span>{copy.athlete.weeksForward}</span>
                      <strong>
                        {summary.completed}/{summary.total} · {summary.percentage}%
                      </strong>
                    </div>
                  </div>
                </Card>
                <Card>
                  <CardHeading title={copy.athlete.yearTitle} description={copy.athlete.yearDescription} />
                  <ol className="athlete-plan">
                    {copy.athlete.plan.map((phase, index) => (
                      <li key={phase.title}>
                        <span>{index + 1}</span>
                        <div>
                          <strong>{phase.title}</strong>
                          <p>{phase.detail}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </Card>
              </div>
              <Card className="section-gap">
                <CardHeading
                  title={copy.athlete.accountabilityTitle}
                  description={copy.athlete.accountabilityDescription}
                  action={
                    <Badge accent>
                      {summary.completed}/{summary.total} {copy.athlete.weeksForward}
                    </Badge>
                  }
                />
                <div className="weekly-steps" role="list" aria-label={copy.athlete.accountabilityTitle}>
                  {weeks.length ? (
                    weeks.map((week) => (
                      <div className={cn("weekly-step", week.madeStep && "made-step")} key={week.week} role="listitem">
                        <div className="weekly-step-top">
                          <span>
                            {dateLabel(week.week, { day: "numeric", month: "short" })} —{" "}
                            {dateLabel(addDays(week.week, 6), { day: "numeric", month: "short" })}
                          </span>
                          <strong>
                            {week.score}/{week.max}
                          </strong>
                        </div>
                        <div className="weekly-step-bar" aria-hidden="true">
                          <span style={{ width: `${(week.score / week.max) * 100}%` }} />
                        </div>
                        <small>{week.madeStep ? copy.athlete.rightDirection : copy.athlete.needsAttention}</small>
                      </div>
                    ))
                  ) : (
                    <p>{copy.athlete.noWeeks}</p>
                  )}
                </div>
                {summary.latest && (
                  <div className="athlete-signals">
                    <strong>{copy.athlete.latestWeek}</strong>
                    <span>{copy.athlete.signals.runs}: {summary.latest.signals.runs}</span>
                    <span>{copy.athlete.signals.runDistance}: {metric(summary.latest.signals.runDistance / 1000, 1)} {copy.common.km}</span>
                    <span>{copy.athlete.signals.purposefulRun}: {summary.latest.signals.purposefulRun ? copy.common.done : copy.common.missing}</span>
                    <span>{copy.athlete.signals.support}: {summary.latest.signals.support ? copy.common.done : copy.common.missing}</span>
                    <span>{copy.athlete.signals.recoveryReadings}: {summary.latest.signals.recoveryReadings}</span>
                  </div>
                )}
              </Card>
            </PagePanel>
            <PagePanel prefix="athlete" id="coach" value={tab}>
              <div className="card-grid equal">
                <Card>
                  <CardHeading title={copy.athlete.coachTitle} description={copy.athlete.coachDescription} />
                  <div className="coach-principles">
                    {copy.athlete.coachPrinciples.map((principle) => (
                      <div key={principle}>
                        <CheckCircle2 size={16} aria-hidden="true" />
                        <span>{principle}</span>
                      </div>
                    ))}
                  </div>
                  <div className="card-footer">{copy.athlete.coachNote}</div>
                </Card>
                <Card>
                  <CardHeading
                    title={copy.athlete.selectedCoach}
                    action={<Badge accent>{coach.name}</Badge>}
                  />
                  <div className="coach-voice-list">
                    {copy.athlete.coaches.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="coach-voice"
                        aria-pressed={selectedCoach === item.id}
                        onClick={() => setSelectedCoach(item.id)}
                      >
                        <span className="coach-voice-icon">
                          {selectedCoach === item.id ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                        </span>
                        <span>
                          <strong>{item.name}</strong>
                          <small>{item.tone}</small>
                          <em>{item.detail}</em>
                        </span>
                      </button>
                    ))}
                  </div>
                </Card>
              </div>
              <Card>
                <CardHeading
                  title={copy.athlete.agentDirection}
                  description={copy.athlete.agentDirectionDetail}
                />
                <div className="agent-brief">
                  <div>
                    <UserRound size={17} aria-hidden="true" />
                    <span>{copy.athlete.voice}</span>
                    <strong>{coach.tone}</strong>
                  </div>
                  <div>
                    <Flag size={17} aria-hidden="true" />
                    <span>{copy.athlete.accountability}</span>
                    <strong>{copy.athlete.accountabilityRule}</strong>
                  </div>
                </div>
              </Card>
            </PagePanel>
          </>
        )}
      </DataGate>
    </>
  );
}
