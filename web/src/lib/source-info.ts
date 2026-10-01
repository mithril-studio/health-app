import type { Dashboard } from './data';

export const sourceCopy = {
  title: 'Some activity details are restricted at the source',
  explanation: 'Intervals.icu does not expose Strava-imported activity details through its API. Planned workouts, recovery, fitness and available aggregate curves still work. Connect Garmin directly to Intervals or upload original activity files to enable detailed analysis.',
  connection: 'Manage Intervals connections',
  restricted: 'Restricted activity',
} as const;

export function restrictedCount(data: Dashboard): number {
  return data.activities.filter(activity => typeof activity.raw._note === 'string' && activity.raw._note.length > 0).length;
}
