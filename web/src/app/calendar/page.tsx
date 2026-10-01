import { Suspense } from "react";
import type { Metadata } from "next";
import { TrainingCalendar } from "@/components/calendar";
import { Skeleton } from "@/components/ui";
import { copy } from "@/lib/i18n";
export const metadata: Metadata = { title: copy.nav.calendar };
export default function Page() { return <Suspense fallback={<Skeleton/>}><TrainingCalendar/></Suspense>; }
