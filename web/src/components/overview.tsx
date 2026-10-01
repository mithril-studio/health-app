"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  ArrowRight,
  CalendarDays,
  Clock3,
  Layers,
  Activity as ActivityIcon,
} from "lucide-react";
import { activityLabel, isRestricted } from "@/lib/source-info";
import { copy } from "@/lib/i18n";
import { addDays, startOfWeek, dateLabel } from "@/lib/dates";
import { sumKnown } from "@/lib/data";
import { duration, metric } from "@/lib/format";
import { useTraining, DataGate } from "./workspace";
import {
  Badge,
  Button,
  Card,
  CardHeading,
  Empty,
  PageHeading,
  SportIcon,
} from "./ui";
import { FitnessCard } from "./fitness";
import { ZonesCard } from "./zones-card";
import { RecoverySnapshot } from "./recovery";
import { GoalCard } from "./goal";
import { ActivityDialog } from "./activity-dialog";
export function Overview() {
  const { data, now, refresh, syncing } = useTraining();
  const [selected, setSelected] = useState<string | null>(null);
  const week = startOfWeek(now);
  const done =
    data?.activities.filter((a) => a.date >= week && a.date <= now) ?? [];
  const planned =
    data?.events.filter(
      (e) =>
        e.date >= week &&
        e.date < addDays(week, 7) &&
        (!e.category || e.category === "WORKOUT"),
    ) ?? [];
  const next =
    data?.events
      .filter((e) => e.date >= now && !e.activityId)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 3) ?? [];
  const stats = [
    {
      label: copy.overview.weekLoad,
      value: metric(sumKnown(done.map((a) => a.load))),
      unit: copy.common.pts,
      Icon: Layers,
    },
    {
      label: copy.overview.weekTime,
      value: duration(sumKnown(done.map((a) => a.duration))),
      unit: "",
      Icon: Clock3,
    },
    {
      label: copy.overview.weekSessions,
      value: String(done.length),
      unit: "",
      Icon: ActivityIcon,
    },
    {
      label: copy.overview.plan,
      value: `${planned.filter((e) => e.activityId).length}`,
      unit: `/ ${planned.length}`,
      Icon: CalendarDays,
    },
  ];
  return (
    <>
      <PageHeading
        title={copy.overview.title}
        action={
          <Badge>
            {dateLabel(now, {
              weekday: "short",
              day: "numeric",
              month: "long",
            })}
          </Badge>
        }
      />
      <DataGate>
        {data && (
          <>
            {!data.activities.length && !data.events.length && (
              <div className="welcome-banner">
                <div>
                  <h2>{copy.sync.empty}</h2>
                  <p>{copy.sync.emptyDetail}</p>
                </div>
                <Button onClick={() => void refresh(true)} disabled={syncing}>
                  {copy.common.refresh}
                  <ArrowRight size={14} aria-hidden="true" />
                </Button>
              </div>
            )}
            <div className="section-label">
              <span>{copy.overview.week}</span>
              <span>
                {dateLabel(week)} — {dateLabel(addDays(week, 6))}
              </span>
            </div>
            <div className="metric-grid">
              {stats.map(({ label, value, unit, Icon }) => (
                <Card key={label} className="metric-card">
                  <div className="metric-label">
                    <span>{label}</span>
                    <Icon size={15} strokeWidth={1.5} aria-hidden="true" />
                  </div>
                  <div className="metric-value">
                    {value}
                    <span>{unit}</span>
                  </div>
                </Card>
              ))}
            </div>
            <div className="card-grid equal">
              <FitnessCard
                data={data}
                oldest={addDays(now, -83)}
                newest={now}
                overview
              />
              <ZonesCard data={data} week={week} />
            </div>
            <div className="card-grid equal">
              <div className="stack">
                <Card className="next-card">
                  <CardHeading
                    title={copy.overview.next}
                    action={
                      <Link
                        href="/calendar"
                        className="icon-link"
                        aria-label={copy.nav.calendar}
                      >
                        <ArrowUpRight size={17} aria-hidden="true" />
                      </Link>
                    }
                  />
                  {next.length ? (
                    <div className="next-list">
                      {next.map((e) => (
                        <Link
                          href={`/calendar?date=${e.date}`}
                          key={e.id}
                          className="next-row"
                        >
                          <div className="date-block">
                            <span>
                              {dateLabel(e.date, { weekday: "short" })}
                            </span>
                            <strong>
                              {dateLabel(e.date, { day: "2-digit" })}
                            </strong>
                          </div>
                          <div className="session-info">
                            <strong>{e.name || copy.sports[e.sport]}</strong>
                            <span>
                              {copy.sports[e.sport]} · {duration(e.duration)}
                            </span>
                          </div>
                          <ArrowUpRight size={14} aria-hidden="true" />
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      title={copy.overview.noNext}
                      description={copy.overview.noNextDetail}
                    />
                  )}
                </Card>
              </div>
              <Card>
                <CardHeading
                  title={copy.overview.weekRhythm}
                  action={
                    <Link className="inline-link" href="/calendar">
                      {copy.nav.calendar}
                      <ArrowUpRight size={13} aria-hidden="true" />
                    </Link>
                  }
                />
                <div className="week-strip">
                  {Array.from({ length: 7 }, (_, i) => addDays(week, i)).map(
                    (day) => {
                      const activities = done.filter((a) => a.date === day);
                      const events = planned.filter(
                        (e) => e.date === day && !e.activityId,
                      );
                      return (
                        <Link
                          href={`/calendar?date=${day}`}
                          key={day}
                          className={`week-strip-day ${day === now ? "is-today" : ""}`}
                        >
                          <span>
                            {dateLabel(day, { weekday: "short" })}
                            <strong>
                              {dateLabel(day, { day: "numeric" })}
                            </strong>
                          </span>
                          <div className="week-markers">
                            {activities.map((a) => (
                              <span
                                key={a.id}
                                title={`${a.name} · ${copy.common.done}`}
                                className="week-marker done"
                              />
                            ))}
                            {events.map((e) => (
                              <span
                                key={e.id}
                                title={`${e.name} · ${copy.common.planned}`}
                                className="week-marker planned"
                              />
                            ))}
                            {!activities.length && !events.length && (
                              <span className="week-marker empty" />
                            )}
                          </div>
                          <small>
                            {activities.length
                              ? `${activities.length} ${copy.common.done.toLowerCase()}`
                              : events.length
                                ? `${events.length} ${copy.common.planned.toLowerCase()}`
                                : copy.common.none}
                          </small>
                        </Link>
                      );
                    },
                  )}
                </div>
              </Card>
            </div>
            <div className="card-grid equal">
              <RecoverySnapshot data={data} now={now} />
              <GoalCard data={data} compact />
            </div>
            <Card>
              <CardHeading
                title={copy.overview.recent}
                action={
                  <Link href="/calendar" className="inline-link">
                    {copy.common.viewAll}
                    <ArrowUpRight size={13} aria-hidden="true" />
                  </Link>
                }
              />
              {data.activities.length ? (
                <div className="activity-list">
                  {[...data.activities]
                    .filter((a) => a.date <= now)
                    .reverse()
                    .slice(0, 5)
                    .map((a) => (
                      <button
                        className="activity-row"
                        onClick={() => setSelected(a.id)}
                        key={a.id}
                      >
                        <SportIcon sport={a.sport} />
                        <span className="session-info">
                          <strong>{activityLabel(a)}</strong>
                          <span>
                            {dateLabel(a.date)} · {copy.sports[a.sport]}
                          </span>
                        </span>
                        <span className="activity-metric">
                          {a.distance !== null
                            ? `${metric(a.distance / 1000, 1)} ${copy.common.km}`
                            : copy.common.none}
                        </span>
                        <span className="activity-metric">
                          {duration(a.duration)}
                        </span>
                        <Badge accent={!isRestricted(a)}>
                          {isRestricted(a)
                            ? copy.sources.restrictedBadge
                            : copy.common.done}
                        </Badge>
                        <ArrowUpRight size={14} aria-hidden="true" />
                      </button>
                    ))}
                </div>
              ) : (
                <Empty
                  title={copy.overview.noActivities}
                  description={copy.overview.noActivitiesDetail}
                />
              )}
            </Card>
          </>
        )}
      </DataGate>
      <ActivityDialog id={selected} onClose={() => setSelected(null)} />
    </>
  );
}
