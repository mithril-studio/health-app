import { Info, ArrowUpRight } from 'lucide-react';
import type { Dashboard } from '@/lib/data';
import { restrictedCount, sourceCopy } from '@/lib/source-info';

export function SourceNotice({ data }: { data: Dashboard }) {
  const count = restrictedCount(data);
  if (!count) return null;
  return <aside className="welcome-banner" aria-label={sourceCopy.title}>
    <Info size={20} aria-hidden="true" />
    <div>
      <h2>{sourceCopy.title} <span className="badge">{count}</span></h2>
      <p>{sourceCopy.explanation}</p>
      <a className="inline-link" href="https://intervals.icu/settings" target="_blank" rel="noopener noreferrer">
        {sourceCopy.connection}<ArrowUpRight size={13} aria-hidden="true" />
      </a>
    </div>
  </aside>;
}
