"use client";
import { HeartPulse, Moon, Activity } from "lucide-react";
import type { Dashboard } from "@/lib/data";
import { dateLabel } from "@/lib/dates";
import { metric, duration } from "@/lib/format";
import { copy } from "@/lib/i18n";
import { Card, CardHeading } from "./ui";
export function RecoverySnapshot({ data, now }: { data: Dashboard; now: string }) {
  const rows = data.wellness.filter(w => w.date <= now);
  const metrics = [
    { key: "hrv" as const, label: copy.insights.hrv, unit: copy.common.ms, Icon: Activity, format: (v: number) => metric(v) },
    { key: "sleep" as const, label: copy.insights.sleep, unit: "", Icon: Moon, format: duration },
    { key: "restingHR" as const, label: copy.insights.restingHR, unit: copy.common.bpm, Icon: HeartPulse, format: (v: number) => metric(v) }
  ];
  return <Card><CardHeading title={copy.overview.recovery} description={copy.overview.recoveryDetail} /><div className="recovery-snapshot">{metrics.map(({ key, label, unit, Icon, format }) => { const last = rows.findLast(w => w[key] !== null); return <div className="recovery-row" key={key}><span className="recovery-icon"><Icon size={17} strokeWidth={1.5} aria-hidden="true" /></span><div><span>{label}</span><small>{last ? dateLabel(last.date, { day: "numeric", month: "short" }) : copy.common.unknown}</small></div><strong>{last ? format(last[key]!) : copy.common.none}<small>{last && unit}</small></strong></div>; })}</div><div className="card-footer">{copy.insights.recoveryNote}</div></Card>;
}
