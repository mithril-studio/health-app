const formatter = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Amsterdam', year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function scheduledJob(now) {
  const p=Object.fromEntries(formatter.formatToParts(now).map(x=>[x.type,x.value]));
  const time=`${p.hour}:${p.minute}`;
  const kind=time==='08:30'?'morning':time==='21:00'?'evening':null;
  return kind ? {kind,key:`${kind}:${p.year}-${p.month}-${p.day}`} : null;
}
export const activityKey = a => `activity:${a.id}`;
export function authorizedUpdate(update, chatId) {
  const message=update.message;
  return Boolean(message && message.chat?.type==='private' && String(message.chat.id)===String(chatId) && typeof message.text==='string');
}
async function safeEqual(a,b) {
  if (!a || !b) return false;
  const digest=async text=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
  const [aa,bb]=await Promise.all([digest(a),digest(b)]);
  let mismatch=0;
  for(let i=0;i<aa.length;i++) mismatch|=aa[i]^bb[i];
  return mismatch===0;
}
async function box(env, path, body) {
  const url=new URL(env.BOX_URL);
  if(url.protocol!=='https:') throw new Error('BOX_URL must use HTTPS');
  const response=await fetch(new URL(path,url),{method:'POST',headers:{Authorization:`Bearer ${env.BOX_SHARED_SECRET}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(110000),redirect:'error'});
  if(!response.ok) throw new Error(`Box request failed (${response.status})`);
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
    if(path!=='/telegram' || request.method!=='POST') return new Response('Not found',{status:404});
    if(!await safeEqual(request.headers.get('X-Telegram-Bot-Api-Secret-Token'),env.TELEGRAM_WEBHOOK_SECRET)) return new Response('Unauthorized',{status:401});
    if(Number(request.headers.get('Content-Length')||0)>32768) return new Response('Too large',{status:413});
    const text=await request.text();
    if(text.length>32768) return new Response('Too large',{status:413});
    let update;
    try {update=JSON.parse(text);} catch {return new Response('Bad JSON',{status:400});}
    if(!authorizedUpdate(update,env.TELEGRAM_CHAT_ID)) return Response.json({ok:true});
    try {
      await box(env,'/api/internal/telegram',update);
      return Response.json({ok:true});
    } catch {
      // A non-2xx makes Telegram retry; never acknowledge work that was lost.
      console.error('Telegram forwarding failed; delivery will retry');
      return new Response('Temporarily unavailable',{status:503});
    }
  },
  async scheduled(event,env,ctx) {
    const now=new Date(event.scheduledTime);
    const job=scheduledJob(now);
    const task=async()=>{
      if(job && !await env.STATE.get(job.key)) {
        await box(env,'/api/internal/job',job);
        await env.STATE.put(job.key,'sent',{expirationTtl:259200});
      }
      if(event.cron==='*/20 * * * *') await pollActivities(env,now);
    };
    ctx.waitUntil(task());
  }
};
