import type { Dashboard } from "./data";

import { copy } from "./i18n";
import type { Activity } from "./data";
export const sourceCopy = copy.sources;
export function isRestricted(activity: Activity) {
  return (
    typeof activity.raw._note === "string" && activity.raw._note.length > 0
  );
}
export function activityLabel(activity: Activity) {
  return isRestricted(activity)
    ? copy.sources.restricted
    : activity.name || copy.sports[activity.sport];
}

export function restrictedCount(data: Dashboard): number {
  return data.activities.filter(isRestricted).length;
}
