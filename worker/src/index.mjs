const formatter = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Amsterdam', year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function scheduledJob(now) {
  const p=Object.fromEntries(formatter.formatToParts(now).map(x=>[x.type,x.value]));
  const time=`${p.hour}:${p.minute}`;
  const kind=time==='08:30'?'morning':time==='21:00'?'evening':null;
  return kind ? {kind,key:`${kind}:${p.year}-${p.month}-${p.day}`} : null;
}
export const activityKey = a => `activity:${a.id}`;
class BoxError extends Error {
  constructor(status) {super(`Box request failed (${status})`);this.status=status;}
}
async function box(env, path, body) {
  const url=new URL(env.BOX_URL);
  if(url.protocol!=='https:') throw new Error('BOX_URL must use HTTPS');
  const response=await fetch(new URL(path,url),{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${env.BOX_SHARED_SECRET}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(110000),redirect:'error'});
  if(!response.ok) throw new BoxError(response.status);
  return response;
}
export async function pollActivities(env, now) {
  const oldest=new Date(now.getTime()-3*86400000).toISOString().slice(0,10);
  const newest=new Date(now.getTime()+86400000).toISOString().slice(0,10);
  const response=await fetch(`https://intervals.icu/api/v1/athlete/${encodeURIComponent(env.INTERVALS_ATHLETE_ID)}/activities?oldest=${oldest}&newest=${newest}`,{headers:{Authorization:`Basic ${btoa(`API_KEY:${env.INTERVALS_API_KEY}`)}`,'User-Agent':'CoachReachy/1.0'},signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw new Error(`Intervals poll failed (${response.status})`);
  const activities=await response.json();
  if(!Array.isArray(activities)) throw new Error('Invalid Intervals response');
  const initialized=await env.STATE.get('poll:initialized');
  // Initial snapshot is a baseline, not three days of unsolicited reports.
  if(!initialized) {
    for(const activity of activities) await env.STATE.put(activityKey(activity),'baseline',{expirationTtl:604800});
    await env.STATE.put('poll:initialized','true');
    return;
  }
  for(const activity of activities) {
    const key=activityKey(activity);
    if(await env.STATE.get(key)) continue;
    await box(env,'/api/internal/job',{kind:'activity',key,activity_id:String(activity.id)});
    // Only acknowledge after successful processing. Backend deduplicates races/retries.
    await env.STATE.put(key,'sent',{expirationTtl:604800});
  }
}
export default {
  async fetch(request,env) {
    const path=new URL(request.url).pathname;
    if(path==='/health' && request.method==='GET') return Response.json({ok:true,service:'coach-reachy-scheduler'});
    return new Response('Not found',{status:404});
  },
  async scheduled(event,env,ctx) {
    const now=new Date(event.scheduledTime);
    const job=scheduledJob(now);
    const task=async()=>{
      if(job && !await env.STATE.get(job.key)) {
        await env.STATE.put(`pending:${job.key}`,JSON.stringify(job),{expirationTtl:43200});
      }
      // Every tick retries failed touchpoints for up to 12 hours, not just tomorrow.
      const pending=await env.STATE.list({prefix:'pending:'});
      let failure;
      for(const {name} of pending.keys) {
        const raw=await env.STATE.get(name);
        if(!raw) continue;
        const queued=JSON.parse(raw);
        try {
          if(!await env.STATE.get(queued.key)) {
            await box(env,'/api/internal/job',queued);
            await env.STATE.put(queued.key,'sent',{expirationTtl:259200});
          }
          await env.STATE.delete(name);
        } catch(error) { failure=error; }
      }
      if(event.cron==='*/20 * * * *') await pollActivities(env,now);
      if(failure) throw failure;
    };
    ctx.waitUntil(task());
  }
};
