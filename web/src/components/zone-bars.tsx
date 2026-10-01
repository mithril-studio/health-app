"use client";
import type { Zone } from "@/lib/data";
import { copy } from "@/lib/i18n";
import { duration } from "@/lib/format";
import { Empty } from "./ui";
export function ZoneBars({ zones }: { zones: Zone[] }) {
  const total = zones.reduce((sum,z)=>sum+z.seconds,0);
  if (!zones.length) return <Empty title={copy.insights.zoneEmpty}/>;
  return <div className="zone-bars">{zones.map((z,i)=><div className="zone-row" key={z.zone}><span>{z.zone}</span><div className="bar-track"><div className={`bar-value zone-${Math.min(i,5)}`} style={{width:`${total ? z.seconds/total*100 : 0}%`}}/></div><span>{duration(z.seconds)}</span><small>{total?Math.round(z.seconds/total*100):0}%</small></div>)}</div>;
}
