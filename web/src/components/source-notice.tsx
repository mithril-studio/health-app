import { Info, ArrowUpRight } from "lucide-react";
import type { Dashboard } from "@/lib/data";
import { count } from "@/lib/format";
import { restrictedCount, sourceCopy } from "@/lib/source-info";

function ConnectionLink() {
  return (
    <a
      className="inline-link"
      href="https://intervals.icu/settings"
      target="_blank"
      rel="noopener noreferrer"
    >
      {sourceCopy.connection}
      <ArrowUpRight size={13} aria-hidden="true" />
    </a>
  );
}
/** Explains restricted activities where their missing metrics would show. */
export function RestrictedNote({
  restricted,
  one,
  many,
}: {
  restricted: number;
  one: string;
  many: string;
}) {
  if (!restricted) return null;
  return (
    <p className="coverage-note restricted-note">
      {count(restricted, one, many)} <ConnectionLink />
    </p>
  );
}
export function SourceNotice({ data }: { data: Dashboard }) {
  const restricted = restrictedCount(data);
  if (!restricted) return null;
  return (
    <aside className="source-notice" aria-label={sourceCopy.title}>
      <details>
        <summary>
          <Info size={16} aria-hidden="true" />
          <span>{sourceCopy.title}</span>
          <span className="badge">{restricted}</span>
        </summary>
        <p>{sourceCopy.explanation}</p>
        <h4>{sourceCopy.affectsTitle}</h4>
        <ul>
          {sourceCopy.affects.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>{sourceCopy.unaffected}</p>
        <h4>{sourceCopy.stepsTitle}</h4>
        <ol>
          {sourceCopy.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <ConnectionLink />
      </details>
    </aside>
  );
}
