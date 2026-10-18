import { addDays, startOfWeek } from "./dates";
import type { Activity, Dashboard, Wellness } from "./data";

export type WeeklyStep = {
  week: string;
  score: number;
  max: number;
  madeStep: boolean;
  signals: {
    runs: number;
    runDistance: number;
    purposefulRun: boolean;
    support: boolean;
    recoveryReadings: number;
  };
};

function weekActivities(activities: Activity[], week: string) {
  const end = addDays(week, 7);
  return activities.filter((activity) => activity.date >= week && activity.date < end);
}

function weekWellness(wellness: Wellness[], week: string) {
  const end = addDays(week, 7);
  return wellness.filter((row) => row.date >= week && row.date < end);
}

export function weeklyAccountability(data: Dashboard, now: string, count = 12): WeeklyStep[] {
  const current = startOfWeek(now);
  return Array.from({ length: count }, (_, index) => addDays(current, (index - count + 1) * 7)).map(
    (week) => {
      const activities = weekActivities(data.activities, week);
      const runs = activities.filter((activity) => activity.sport === "run");
      const runDistance = runs.reduce((sum, run) => sum + (run.distance ?? 0), 0);
      const purposefulRun = runs.some(
        (run) => (run.distance ?? 0) >= 5000 || (run.load ?? 0) >= 50 || (run.duration ?? 0) >= 35 * 60,
      );
      const support = activities.some((activity) => activity.sport === "gym" || activity.sport === "football");
      const recoveryReadings = weekWellness(data.wellness, week).filter(
        (row) => row.hrv !== null || row.sleep !== null || row.restingHR !== null,
      ).length;
      const score = [
        runs.length >= 3,
        runDistance >= 15000,
        purposefulRun,
        support,
        recoveryReadings >= 3,
      ].filter(Boolean).length;
      return {
        week,
        score,
        max: 5,
        madeStep: score >= 3,
        signals: { runs: runs.length, runDistance, purposefulRun, support, recoveryReadings },
      };
    },
  );
}

export function accountabilitySummary(weeks: WeeklyStep[]) {
  const completed = weeks.filter((week) => week.madeStep).length;
  const latest = weeks.at(-1) ?? null;
  return {
    completed,
    total: weeks.length,
    latest,
    percentage: weeks.length ? Math.round((completed / weeks.length) * 100) : 0,
  };
}
