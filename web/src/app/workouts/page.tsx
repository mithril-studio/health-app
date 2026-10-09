import type { Metadata } from "next";
import { Workouts } from "@/components/workouts";
import { copy } from "@/lib/i18n";
export const metadata: Metadata = {
  title: copy.nav.workouts,
  referrer: "no-referrer",
};
export default function Page() {
  return <Workouts />;
}
