"use client";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { addDays, dateLabel, startOfWeek } from "@/lib/dates";
import { normalizeCurves, recentWeeks, sumKnown, weeklyLoad, weeklyZones, type Dashboard, type CurvePoint, type Sport } from "@/lib/data";
import { metric, pace, duration } from "@/lib/format";
import { copy } from "@/lib/i18n";
import { DataGate, useTraining } from "./workspace";
import { Badge, Button, Card, CardHeading, Empty, ErrorNotice, PageHeading, Skeleton, SportIcon } from "./ui";
import { TrendChart, dailyRows, type ChartRow, type Series } from "./charts";
import { FitnessCard } from "./fitness";
import { GoalCard } from "./goal";
import { ZoneBars } from "./zone-bars";
export function Insights() {
  const { data, now } = useTraining(); const [period,setPeriod]=useState(84); const oldest=addDays(now,-period+1); const [week,setWeek]=useState(startOfWeek(now));
  return <><PageHeading eyebrow={copy.insights.eyebrow} title={copy.insights.title} description={copy.insights.description} action={<select aria-label={copy.insights.range} value={period} onChange={e=>setPeriod(Number(e.target.value))}><option value={28}>{copy.insights.last28}</option><option value={84}>{copy.insights.last84}</option><option value={365}>{copy.insights.lastYear}</option></select>}/><DataGate>{data&&<><div className="section-gap"><FitnessCard data={data} oldest={oldest} newest={now}/></div><div className="section-gap"><CurvesCard/></div><div className="insight-week-control"><span>{copy.overview.week}</span><div><Button size="icon" variant="ghost" aria-label={copy.common.previous} disabled={week<=addDays(now,-350)} onClick={()=>setWeek(addDays(week,-7))}><ChevronLeft size={15} aria-hidden="true"/></Button><strong>{dateLabel(week)} — {dateLabel(addDays(week,6))}</strong><Button size="icon" variant="ghost" aria-label={copy.common.next} disabled={week>=startOfWeek(now)} onClick={()=>setWeek(addDays(week,7))}><ChevronRight size={15} aria-hidden="true"/></Button></div></div><div className="card-grid equal"><ZonesCard data={data} week={week}/><LoadCard data={data} week={week}/></div><Card className="section-gap"><CardHeading title={copy.insights.sportLoad} description={copy.insights.sportLoadDetail}/><SportLoadChart data={data} now={now} period={period}/><div className="card-footer">{copy.insights.loadNote}</div></Card><RecoveryCard data={data} oldest={oldest} now={now}/><GoalCard data={data}/></>}</DataGate></>;
}
function CurvesCard() {
  const [sport,setSport]=useState<"Run"|"Ride">("Run");const [points,setPoints]=useState<CurvePoint[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState("");const [version,setVersion]=useState(0);
  const { data } = useTraining();
  useEffect(()=>{const controller=new AbortController();setLoading(true);setError("");setPoints([]);api(`/api/curves?sport=${sport}&period=84`,{signal:controller.signal}).then(result=>setPoints(normalizeCurves(result,sport))).catch(e=>{if(!controller.signal.aborted)setError(errorMessage(e));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[sport,version,data]);
  return <Card><CardHeading title={copy.insights.curves} description={copy.insights.curvesDetail} action={<div className="segmented"><button aria-pressed={sport==="Run"} onClick={()=>setSport("Run")}>{copy.insights.running}</button><button aria-pressed={sport==="Ride"} onClick={()=>setSport("Ride")}>{copy.insights.cycling}</button></div>}/>{loading?<Skeleton compact/>:error?<div className="card-body"><ErrorNotice message={error} retry={()=>setVersion(v=>v+1)}/></div>:<TrendChart rows={points} series={[{key:"value",name:sport==="Run"?copy.insights.running:copy.insights.cycling,area:true}]} title={sport==="Run"?copy.insights.effortDistance:copy.insights.effortDuration} empty={copy.insights.curveEmpty} xKey="x" xFormat={v=>sport==="Run"?`${metric(Number(v)/1000,2)} ${copy.common.km}`:duration(Number(v))} yFormat={v=>sport==="Run"?pace(v):`${metric(v)} ${copy.common.watts}`} height={250}/>}<div className="card-footer">{copy.insights.curveNote}</div></Card>;
}
function ZonesCard({data,week}:{data:Dashboard;week:string}) {
  const [kind,setKind]=useState<"hr"|"pace"|"power">("hr"); const [sport,setSport]=useState<Sport|"all">("all"); const result=weeklyZones(data.activities,week,kind,sport);
  return <Card><CardHeading title={copy.insights.zones} description={copy.insights.zonesDetail}/><div className="card-body"><div className="zone-controls"><div className="segmented">{(["hr","pace","power"] as const).map(key=><button key={key} aria-pressed={kind===key} onClick={()=>setKind(key)}>{copy.common[key]}</button>)}</div><select aria-label={copy.common.sport} value={sport} onChange={e=>setSport(e.target.value as Sport|"all")}><option value="all">{copy.common.allSports}</option>{Object.entries(copy.sports).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></div><ZoneBars zones={result.zones}/><p className="coverage-note">{result.measured} / {result.total} {copy.insights.zoneCoverage}</p></div><div className="card-footer">{copy.insights.zoneNote}</div></Card>;
}
function LoadCard({data,week}:{data:Dashboard;week:string}) {
  const rows=weeklyLoad(data.activities,week);const total=sumKnown(rows.map(r=>r.load));
  return <Card><CardHeading title={copy.insights.sportLoad} description={copy.insights.sportLoadDetail} action={<Badge>{metric(total)} {copy.common.pts}</Badge>}/><div className="card-body">{rows.length?rows.map(row=><div className="sport-load-row" key={row.sport}><SportIcon sport={row.sport}/><div><strong>{copy.sports[row.sport]}</strong><small>{row.count} {copy.common.sessions}{row.missing?` · ${row.missing} ${copy.insights.missingLoad}`:""}</small><div className="bar-track"><div className="bar-value" style={{width:`${total&&row.load!==null?row.load/total*100:0}%`}}/></div></div><span>{metric(row.load)}</span></div>):<Empty title={copy.insights.noLoad}/>}</div><div className="card-footer">{copy.insights.loadNote}</div></Card>;
}
function SportLoadChart({data,now,period}:{data:Dashboard;now:string;period:number}) {
  const sports=Object.keys(copy.sports) as Sport[];
  const weeks=recentWeeks(now,Math.min(52,Math.ceil(period/7)));
  const rows: ChartRow[]=weeks.map(week=>{const load=weeklyLoad(data.activities,week);return {date:week,...Object.fromEntries(sports.map(s=>[s,load.find(r=>r.sport===s)?.load??null]))};});
  const series=sports.filter(s=>rows.some(r=>typeof r[s]==="number")).map((sport,i)=>({key:sport,name:copy.sports[sport],tone:(["primary","secondary","tertiary"] as const)[i%3],dashed:i>2}));
  return <TrendChart rows={rows} series={series} title={copy.insights.sportLoad} empty={copy.insights.noLoad} height={220}/>;
}
function RecoveryCard({data,oldest,now}:{data:Dashboard;oldest:string;now:string}) {
  const [kind,setKind]=useState<"hrv"|"sleep"|"restingHR"|"load">("hrv");
  const days=new Set(data.wellness.filter(w=>w.date>=oldest&&w.date<=now).map(w=>w.date)); data.activities.filter(a=>a.date>=oldest&&a.date<=now).forEach(a=>days.add(a.date));
  const rows=[...days].sort().map(date=>{const wellness=data.wellness.find(w=>w.date===date);return {date,hrv:wellness?.hrv??null,sleep:wellness?.sleep===null||wellness?.sleep===undefined?null:wellness.sleep/3600,restingHR:wellness?.restingHR??null,load:sumKnown(data.activities.filter(a=>a.date===date).map(a=>a.load))};});
  const labels={hrv:copy.insights.hrv,sleep:copy.insights.sleep,restingHR:copy.insights.restingHR,load:copy.common.load};const units={hrv:copy.common.ms,sleep:copy.common.hours,restingHR:copy.common.bpm,load:copy.common.pts};
  return <Card className="section-gap"><CardHeading title={copy.insights.recovery} description={copy.insights.recoveryDetail}/><div className="recovery-tabs">{(["hrv","sleep","restingHR","load"] as const).map(key=>{const latest=rows.findLast(r=>r[key]!==null);return <button key={key} aria-pressed={kind===key} onClick={()=>setKind(key)}><span>{labels[key]}</span><strong>{metric(latest?.[key],key==="sleep"?1:0)}<small>{units[key]}</small></strong><span>{latest?dateLabel(latest.date):copy.insights.unavailable}</span></button>;})}</div><TrendChart rows={dailyRows(rows,["hrv","sleep","restingHR","load"])} series={[{key:kind,name:labels[kind],area:kind!=="load",bar:kind==="load"}]} title={`${copy.insights.recovery} · ${labels[kind]}`} empty={copy.insights.noRecovery} yFormat={v=>`${metric(v,kind==="sleep"?1:0)} ${units[kind]}`} height={230}/><div className="card-footer">{copy.insights.recoveryNote}</div></Card>;
}
