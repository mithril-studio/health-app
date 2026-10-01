import type { Metadata } from "next";
import { Coach } from "@/components/coach";
import { copy } from "@/lib/i18n";
export const metadata: Metadata = { title: copy.nav.coach };
export default function Page() {
  return <Coach />;
}
