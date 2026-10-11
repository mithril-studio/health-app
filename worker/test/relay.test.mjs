import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker,{pollActivities} from '../src/index.mjs';
function store(){const data=new Map();return {data,get:async k=>data.get(k),put:async(k,v)=>data.set(k,v),delete:async k=>data.delete(k),list:async({prefix})=>({keys:[...data.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name}))})};}
const env=()=>({BOX_URL:'https://team-endurance.boxd.sh',BOX_SHARED_SECRET:'test',INTERVALS_ATHLETE_ID:'test',INTERVALS_API_KEY:'test',STATE:store()});
test('health reports the scheduler service',async()=>{
 const response=await worker.fetch(new Request('https://worker.example/health'),env());
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{ok:true,service:'team-endurance-scheduler'});
});
test('every route other than health returns 404',async()=>{
 assert.equal((await worker.fetch(new Request('https://worker.example/telegram',{method:'POST',body:'{}'}),env())).status,404);
 assert.equal((await worker.fetch(new Request('https://worker.example/'),env())).status,404);
 assert.equal((await worker.fetch(new Request('https://worker.example/health',{method:'POST'}),env())).status,404);
});
test('activity poll baselines history and only acknowledges successful reports',async t=>{
 const e=env();let activities=[{id:'old'}],calls=0,fail=true;
 t.mock.method(globalThis,'fetch',async url=>{
  if(String(url).startsWith('https://intervals.icu'))return Response.json(activities);
  calls++;return new Response('',{status:fail?503:200});
 });
 const now=new Date('2026-10-01T10:00:00Z');
 await pollActivities(e,now);assert.equal(calls,0);
 activities.push({id:'new'});
 await assert.rejects(pollActivities(e,now));assert.equal(await e.STATE.get('activity:new'),undefined);
 fail=false;await pollActivities(e,now);assert.equal(await e.STATE.get('activity:new'),'sent');
 await pollActivities(e,now);assert.equal(calls,2);
});
test('failed morning report is retried on next poll tick',async t=>{
 const e=env();let fail=true,calls=0,promise;
 t.mock.method(globalThis,'fetch',async url=>{
  if(String(url).startsWith('https://intervals.icu'))return Response.json([]);
  calls++;return new Response('',{status:fail?503:200});
 });
 const ctx={waitUntil:p=>{promise=p}};
 await worker.scheduled({scheduledTime:Date.parse('2026-07-01T06:30:00Z'),cron:'30 6,7 * * *'},e,ctx);
 await assert.rejects(promise);assert.ok(await e.STATE.get('pending:morning:2026-07-01'));
 fail=false;
 await worker.scheduled({scheduledTime:Date.parse('2026-07-01T06:40:00Z'),cron:'*/20 * * * *'},e,ctx);
 await promise;assert.equal(await e.STATE.get('morning:2026-07-01'),'sent');assert.equal(calls,2);
});
