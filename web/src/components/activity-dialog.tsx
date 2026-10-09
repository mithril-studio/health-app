"use client";
import Link from "next/link";
import { taskCopy } from "@/lib/coach-task";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import {
  normalizeActivity,
  record,
  array,
  number,
  text,
  type Activity,
  type Raw,
} from "@/lib/data";
import { activityLabel, isRestricted } from "@/lib/source-info";
import { copy } from "@/lib/i18n";
import { dateLabel } from "@/lib/dates";
import { metric, duration, pace } from "@/lib/format";
import {
  Button,
  buttonStyle,
  Badge,
  Empty,
  ErrorNotice,
  ExternalActivityLink,
  Modal,
  Skeleton,
  SportIcon,
} from "./ui";
import { useTraining } from "./workspace";
import { ZoneBars } from "./zone-bars";
export function ActivityDialog({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const { refresh } = useTraining();
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [intervals, setIntervals] = useState<Raw[]>([]);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setActivity(null);
    setConfirmRemove(false);
    setIntervals([]);
    setError("");
    setLoading(true);
    api(`/api/activity/${encodeURIComponent(id)}`, {
      signal: controller.signal,
    })
      .then((result) => {
        const raw = record(result);
        const normalized = normalizeActivity(raw.activity ?? raw);
        if (!normalized) throw new Error("Invalid activity");
        setActivity(normalized);
        const intervalData = raw.intervals ?? normalized.raw.icu_intervals;
        setIntervals(
          array(
            Array.isArray(intervalData)
              ? intervalData
              : (record(intervalData).icu_intervals ??
                  record(intervalData).intervals),
          ).map(record),
        );
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, version]);
  return (
    <Modal
      open={!!id}
      onClose={onClose}
      title={activity ? activityLabel(activity) : copy.activity.title}
      description={
        activity
          ? `${copy.sports[activity.sport]} · ${dateLabel(activity.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`
          : copy.activity.description
      }
    >
      {loading ? (
        <Skeleton compact />
      ) : error ? (
        <ErrorNotice message={error} retry={() => setVersion((v) => v + 1)} />
      ) : (
        activity && (
          <>
            <div className="activity-summary">
              <SportIcon sport={activity.sport} />
              <Badge accent={!isRestricted(activity)}>
                {isRestricted(activity)
                  ? copy.sources.restrictedBadge
                  : copy.common.done}
              </Badge>
              {activity.raw.source === "app" ||
              activity.raw.source === "whoop" ? (
                <Badge>
                  {activity.raw.source === "app"
                    ? copy.workouts.appSource
                    : copy.workouts.whoopSource}
                </Badge>
              ) : (
                <ExternalActivityLink id={activity.id} />
              )}
              <Link
                className={buttonStyle({ variant: "outline" })}
                href={`/coach?mode=workout&activity_id=${encodeURIComponent(activity.id)}`}
                onClick={onClose}
              >
                {taskCopy.review}
              </Link>
            </div>
            {isRestricted(activity) && (
              <p className="restricted-detail">{copy.sources.explanation}</p>
            )}
            <dl className="detail-metrics">
              {[
                [
                  copy.common.distance,
                  activity.distance === null
                    ? copy.common.none
                    : `${metric(activity.distance / 1000, 2)} ${copy.common.km}`,
                ],
                [copy.common.duration, duration(activity.duration)],
                [copy.common.load, metric(activity.load)],
                [
                  copy.activity.averageHR,
                  activity.hr === null
                    ? copy.common.none
                    : `${metric(activity.hr)} ${copy.common.bpm}`,
                ],
                [
                  copy.activity.averagePower,
                  activity.watts === null
                    ? copy.common.none
                    : `${metric(activity.watts)} ${copy.common.watts}`,
                ],
                [copy.activity.elapsed, duration(activity.elapsed)],
              ].map(([name, value]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {text(activity.raw.description) && (
              <p>{text(activity.raw.description)}</p>
            )}
            {activity.raw.source === "whoop" && (
              <p>
                {copy.workouts.strain}:{" "}
                {metric(number(activity.raw.whoop_strain), 1)}
              </p>
            )}
            {activity.raw.source === "app" && (
              <div className="workout-remove">
                {confirmRemove ? (
                  <>
                    <p>{copy.workouts.removeDetail}</p>
                    <Button
                      disabled={removing}
                      variant="destructive"
                      onClick={async () => {
                        setRemoving(true);
                        try {
                          await api(
                            `/api/sessions/${encodeURIComponent(activity.id)}/delete`,
                            { method: "POST" },
                          );
                          await refresh();
                          onClose();
                        } catch (e) {
                          setError(errorMessage(e));
                        } finally {
                          setRemoving(false);
                        }
                      }}
                    >
                      {copy.workouts.remove}
                    </Button>{" "}
                    <Button
                      variant="ghost"
                      disabled={removing}
                      onClick={() => setConfirmRemove(false)}
                    >
                      {copy.common.cancel}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    onClick={() => setConfirmRemove(true)}
                  >
                    {copy.workouts.remove}
                  </Button>
                )}
              </div>
            )}
            <h3 className="detail-title">{copy.activity.intervals}</h3>
            {intervals.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{copy.activity.interval}</th>
                      <th>{copy.common.duration}</th>
                      <th>{copy.common.distance}</th>
                      <th>{copy.common.pace}</th>
                      <th>{copy.common.hr}</th>
                      <th>{copy.common.power}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {intervals.map((row, i) => {
                      const speed = number(row.average_speed);
                      const labels: Record<string, string> = {
                        WORK: copy.activity.work,
                        RECOVERY: copy.activity.recovery,
                        WARMUP: copy.activity.warmup,
                        COOLDOWN: copy.activity.cooldown,
                      };
                      return (
                        <tr key={i}>
                          <th scope="row">
                            {text(row.label) ||
                              labels[text(row.type)] ||
                              text(row.type) ||
                              `${copy.activity.interval} ${i + 1}`}
                          </th>
                          <td>
                            {duration(
                              number(row.moving_time ?? row.elapsed_time),
                            )}
                          </td>
                          <td>
                            {number(row.distance) === null
                              ? copy.common.none
                              : `${metric(number(row.distance)! / 1000, 2)} ${copy.common.km}`}
                          </td>
                          <td>
                            {speed && speed > 0
                              ? pace(1000 / speed)
                              : copy.common.none}
                          </td>
                          <td>{metric(number(row.average_heartrate))}</td>
                          <td>
                            {metric(
                              number(
                                row.average_watts ?? row.icu_average_watts,
                              ),
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title={copy.activity.noIntervals} />
            )}
            <h3 className="detail-title">{copy.activity.zones}</h3>
            <ActivityZones activity={activity} />
          </>
        )
      )}
    </Modal>
  );
}
function ActivityZones({ activity }: { activity: Activity }) {
  const [kind, setKind] = useState<"hr" | "pace" | "power">("hr");
  return (
    <>
      <div className="segmented" aria-label={copy.activity.zones}>
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
      <ZoneBars zones={activity.zones[kind]} />
    </>
  );
}
