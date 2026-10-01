"use client";
import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  GripVertical,
  ArrowRight,
  Check,
} from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import {
  addDays,
  calendarDays,
  dateLabel,
  shiftMonth,
  validDate,
} from "@/lib/dates";
import {
  normalizeDashboard,
  type Dashboard,
  type PlannedEvent,
} from "@/lib/data";
import { activityLabel, isRestricted } from "@/lib/source-info";
import { copy } from "@/lib/i18n";
import { duration, metric } from "@/lib/format";
import { useTraining } from "./workspace";
import { ActivityDialog } from "./activity-dialog";
import {
  Badge,
  Button,
  ErrorNotice,
  Modal,
  PageHeading,
  Skeleton,
  SportIcon,
  cn,
} from "./ui";
export function TrainingCalendar() {
  const { now, data, refresh } = useTraining();
  const search = useSearchParams();
  const initial = search.get("date");
  const [cursor, setCursor] = useState(
    initial && validDate(initial) ? initial : now,
  );
  const [mode, setMode] = useState<"week" | "month">("week");
  const [calendar, setCalendar] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedRange, setLoadedRange] = useState("");
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [sport, setSport] = useState("all");
  const [activityId, setActivityId] = useState<string | null>(null);
  const [event, setEvent] = useState<PlannedEvent | null>(null);
  const [targetDate, setTargetDate] = useState("");
  const [move, setMove] = useState<{
    event: PlannedEvent;
    date: string;
  } | null>(null);
  const [moving, setMoving] = useState(false);
  const [notice, setNotice] = useState("");
  const [dropDay, setDropDay] = useState("");
  const dragged = useRef<string | null>(null);
  const days = calendarDays(cursor, mode);
  const oldest = days[0],
    newest = days.at(-1)!;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api(`/api/dashboard?${new URLSearchParams({ oldest, newest })}`, {
      signal: controller.signal,
    })
      .then((result) => {
        setCalendar(normalizeDashboard(result));
        setLoadedRange(`${oldest}:${newest}`);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [oldest, newest, version, data]);
  function navigate(direction: number) {
    setCursor(
      mode === "week"
        ? addDays(cursor, direction * 7)
        : shiftMonth(cursor, direction),
    );
  }
  function selectEvent(e: PlannedEvent) {
    setEvent(e);
    setTargetDate(e.date);
    setNotice("");
  }
  function proposeMove(e: PlannedEvent, date: string) {
    if (!validDate(date) || date === e.date) return;
    setEvent(null);
    setMove({ event: e, date });
    setNotice("");
  }
  async function confirmMove() {
    if (!move || !calendar || moving) return;
    const previous = calendar;
    const chosen = move;
    setMoving(true);
    setError("");
    setCalendar({
      ...calendar,
      events: calendar.events.map((e) =>
        e.id === chosen.event.id ? { ...e, date: chosen.date } : e,
      ),
    });
    try {
      await api("/api/tools/move_workout", {
        method: "POST",
        body: { id: chosen.event.id, date: chosen.date },
      });
      setNotice(copy.calendar.moved);
      setMove(null);
      await refresh();
      setVersion((v) => v + 1);
    } catch {
      setCalendar(previous);
      setError(copy.calendar.moveError);
      setMove(null);
    } finally {
      setMoving(false);
    }
  }
  const activities =
    calendar?.activities.filter((a) => sport === "all" || a.sport === sport) ??
    [];
  const events =
    calendar?.events.filter((e) => sport === "all" || e.sport === sport) ?? [];
  const paired = event?.activityId
    ? calendar?.activities.find((a) => a.id === event.activityId)
    : null;
  return (
    <>
      <PageHeading title={copy.calendar.title} />
      <div className="calendar-toolbar">
        <div className="calendar-date-controls">
          <Button
            variant="outline"
            size="icon"
            aria-label={copy.common.previous}
            disabled={moving}
            onClick={() => navigate(-1)}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={copy.common.next}
            disabled={moving}
            onClick={() => navigate(1)}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </Button>
          <h2>
            {mode === "month"
              ? dateLabel(cursor, { month: "long", year: "numeric" })
              : `${dateLabel(oldest)} – ${dateLabel(newest, { day: "numeric", month: "short", year: "numeric" })}`}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            disabled={moving}
            onClick={() => setCursor(now)}
          >
            {copy.common.today}
          </Button>
        </div>
        <div className="calendar-view-controls">
          <select
            aria-label={copy.common.sport}
            value={sport}
            onChange={(e) => setSport(e.target.value)}
          >
            <option value="all">{copy.common.allSports}</option>
            {Object.entries(copy.sports).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <div className="segmented">
            {(["week", "month"] as const).map((v) => (
              <button
                key={v}
                aria-pressed={mode === v}
                disabled={moving}
                onClick={() => setMode(v)}
              >
                {copy.calendar[v]}
              </button>
            ))}
          </div>
        </div>
      </div>
      {error && (
        <ErrorNotice message={error} retry={() => setVersion((v) => v + 1)} />
      )}
      <p role="status" className="action-notice">
        {notice}
      </p>
      {loading && (!calendar || loadedRange !== `${oldest}:${newest}`) ? (
        <Skeleton />
      ) : (
        <div
          className={cn("calendar-grid", mode === "month" && "month-view")}
          aria-label={copy.nav.calendar}
        >
          {days.map((day) => {
            const dayActivities = activities.filter((a) => a.date === day);
            const dayEvents = events.filter((e) => e.date === day);
            const load = dayActivities
              .filter((a) => a.load !== null)
              .reduce((sum, a) => sum + a.load!, 0);
            return (
              <section
                key={day}
                aria-label={dateLabel(day, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
                className={cn(
                  "calendar-day",
                  day === now && "is-today",
                  day.slice(0, 7) !== cursor.slice(0, 7) &&
                    mode === "month" &&
                    "outside-month",
                  dropDay === day && "drop-target",
                )}
                onDragOver={(e) => {
                  if (dragged.current && !moving) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDropDay(day);
                  }
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node))
                    setDropDay("");
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const planned = events.find((x) => x.id === dragged.current);
                  if (planned && !planned.activityId) proposeMove(planned, day);
                  dragged.current = null;
                  setDropDay("");
                }}
              >
                <div className="calendar-day-heading">
                  <span>{dateLabel(day, { weekday: "short" })}</span>
                  <strong>{dateLabel(day, { day: "numeric" })}</strong>
                  {day === now && (
                    <span className="today-label">{copy.common.today}</span>
                  )}
                </div>
                <div className="calendar-sessions">
                  {dayEvents.map((e) => {
                    const movable =
                      (!e.category || e.category === "WORKOUT") &&
                      !e.activityId;
                    return (
                      <button
                        className={cn(
                          "calendar-session",
                          "planned-session",
                          e.activityId && "paired-session",
                        )}
                        key={`e-${e.id}`}
                        onClick={() => selectEvent(e)}
                        draggable={movable && !moving}
                        onDragStart={(ev) => {
                          dragged.current = e.id;
                          ev.dataTransfer.setData("text/plain", e.id);
                          ev.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => {
                          dragged.current = null;
                          setDropDay("");
                        }}
                      >
                        <span className="session-sport">
                          <SportIcon sport={e.sport} />
                          {movable ? (
                            <GripVertical size={12} aria-hidden="true" />
                          ) : (
                            <Check size={12} aria-hidden="true" />
                          )}
                        </span>
                        <strong>{e.name || copy.sports[e.sport]}</strong>
                        <span>{duration(e.duration)}</span>
                        <Badge accent={!!e.activityId}>
                          {e.activityId
                            ? copy.common.paired
                            : !e.category || e.category === "WORKOUT"
                              ? copy.common.planned
                              : copy.common.note}
                        </Badge>
                      </button>
                    );
                  })}
                  {dayActivities.map((a) => (
                    <button
                      className="calendar-session completed-session"
                      key={`a-${a.id}`}
                      onClick={() => setActivityId(a.id)}
                    >
                      <span className="session-sport">
                        <SportIcon sport={a.sport} />
                        <Check size={12} aria-hidden="true" />
                      </span>
                      <strong>{activityLabel(a)}</strong>
                      <span>
                        {duration(a.duration)}
                        {a.distance !== null
                          ? ` · ${metric(a.distance / 1000, 1)} ${copy.common.km}`
                          : ""}
                      </span>
                      <Badge accent={!isRestricted(a)}>
                        {isRestricted(a)
                          ? copy.sources.restrictedBadge
                          : copy.common.done}
                      </Badge>
                    </button>
                  ))}
                  {!dayEvents.length && !dayActivities.length && (
                    <span className="empty-day">{copy.calendar.emptyDay}</span>
                  )}
                </div>
                {dayActivities.some((a) => a.load !== null) && (
                  <div className="day-load">
                    {metric(load)} {copy.common.pts}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
      <div className="calendar-footer">
        <span>
          <span className="legend-done" />
          {copy.common.done}
          <span className="legend-planned" />
          {copy.common.planned}
        </span>
        <p>{copy.calendar.dragHint}</p>
      </div>
      <ActivityDialog id={activityId} onClose={() => setActivityId(null)} />
      <Modal
        open={!!event}
        onClose={() => setEvent(null)}
        title={event?.name || copy.calendar.plannedDetails}
        description={
          event
            ? `${copy.sports[event.sport]} · ${dateLabel(event.date, { weekday: "long", day: "numeric", month: "long" })}`
            : copy.calendar.plannedDetails
        }
      >
        {event && (
          <>
            <div className="planned-summary">
              <Badge accent={!!event.activityId}>
                {event.activityId ? copy.common.paired : copy.common.planned}
              </Badge>
              <span>
                {copy.calendar.plannedDuration}: {duration(event.duration)}
              </span>
            </div>
            {event.description && (
              <div className="workout-description">{event.description}</div>
            )}
            {paired && (
              <p className="comparison">
                {copy.calendar.plannedDuration}: {duration(event.duration)}
                <ArrowRight size={14} aria-hidden="true" />
                {copy.calendar.doneDuration}: {duration(paired.duration)}
              </p>
            )}
            {event.activityId ? (
              <Button
                onClick={() => {
                  setActivityId(event.activityId);
                  setEvent(null);
                }}
              >
                {copy.calendar.linked}
                <ArrowRight size={15} aria-hidden="true" />
              </Button>
            ) : (
              (!event.category || event.category === "WORKOUT") && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    proposeMove(event, targetDate);
                  }}
                >
                  <p className="muted-text">{copy.calendar.noComparison}</p>
                  <label htmlFor="workout-date">{copy.calendar.moveDate}</label>
                  <div className="move-date-field">
                    <input
                      id="workout-date"
                      type="date"
                      value={targetDate}
                      required
                      onChange={(e) => setTargetDate(e.target.value)}
                    />
                    <Button
                      type="submit"
                      disabled={
                        !validDate(targetDate) || targetDate === event.date
                      }
                    >
                      {copy.calendar.move}
                      <ArrowRight size={14} aria-hidden="true" />
                    </Button>
                  </div>
                </form>
              )
            )}
          </>
        )}
      </Modal>
      <Modal
        open={!!move}
        onClose={() => {
          if (!moving) setMove(null);
        }}
        title={copy.calendar.moveTitle}
        description={copy.calendar.moveDescription}
      >
        {move && (
          <>
            <div className="move-confirm-card">
              <SportIcon sport={move.event.sport} />
              <strong>
                {move.event.name || copy.sports[move.event.sport]}
              </strong>
              <div>
                <span>
                  {dateLabel(move.event.date, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
                <ArrowRight size={16} aria-hidden="true" />
                <span>
                  {dateLabel(move.date, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </div>
            </div>
            <div className="dialog-actions">
              <Button
                variant="outline"
                disabled={moving}
                onClick={() => setMove(null)}
              >
                {copy.common.cancel}
              </Button>
              <Button disabled={moving} onClick={() => void confirmMove()}>
                {moving ? copy.calendar.moving : copy.calendar.moveConfirm}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
