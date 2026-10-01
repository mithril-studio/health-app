import type { Metadata } from "next";
import { Insights } from "@/components/insights";
import { copy } from "@/lib/i18n";
export const metadata: Metadata = { title: copy.nav.insights };
export default function Page() {
  return <Insights />;
}
