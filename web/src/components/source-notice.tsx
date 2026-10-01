import { Info, ArrowUpRight } from "lucide-react";
import type { Dashboard } from "@/lib/data";
import { restrictedCount, sourceCopy } from "@/lib/source-info";

export function SourceNotice({ data }: { data: Dashboard }) {
  const count = restrictedCount(data);
  if (!count) return null;
  return (
    <aside className="source-notice" aria-label={sourceCopy.title}>
      <details>
        <summary>
          <Info size={16} aria-hidden="true" />
          <span>{sourceCopy.title}</span>
          <span className="badge">{count}</span>
        </summary>
        <p>{sourceCopy.explanation}</p>
        <a
          className="inline-link"
          href="https://intervals.icu/settings"
          target="_blank"
          rel="noopener noreferrer"
        >
          {sourceCopy.connection}
          <ArrowUpRight size={13} aria-hidden="true" />
        </a>
      </details>
    </aside>
  );
}
