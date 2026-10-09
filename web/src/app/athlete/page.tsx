import type { Metadata } from "next";
import { Athlete } from "@/components/athlete";
import { copy } from "@/lib/i18n";
export const metadata: Metadata = { title: copy.nav.athlete };
export default function Page() {
  return <Athlete />;
}
