import Link from "next/link";
import { copy } from "@/lib/i18n";
export default function NotFound() {
  return (
    <div className="empty-state">
      <h1>{copy.notFound.title}</h1>
      <p>{copy.notFound.description}</p>
      <Link href="/">{copy.common.back}</Link>
    </div>
  );
}
