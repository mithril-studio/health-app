import type { Metadata } from "next";
import { AthleteSettings } from "@/components/athlete-settings";
import { copy } from "@/lib/i18n";

export const metadata: Metadata = { title: copy.nav.settings };

export default function Page() {
  return <AthleteSettings />;
}
