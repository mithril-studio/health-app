import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scheduledJob, activityKey, authorizedUpdate} from '../src/index.mjs';
test('morning respects Amsterdam DST',()=>{
 assert.equal(scheduledJob(new Date('2026-07-01T06:30:00Z'))?.kind,'morning');
 assert.equal(scheduledJob(new Date('2026-07-01T07:30:00Z')),null);
 assert.equal(scheduledJob(new Date('2026-12-01T07:30:00Z'))?.kind,'morning');
 assert.equal(scheduledJob(new Date('2026-12-01T06:30:00Z')),null);
});
test('evening respects Amsterdam DST',()=>{
 assert.equal(scheduledJob(new Date('2026-07-01T19:00:00Z'))?.kind,'evening');
 assert.equal(scheduledJob(new Date('2026-12-01T20:00:00Z'))?.kind,'evening');
 assert.equal(scheduledJob(new Date('2026-12-01T19:00:00Z')),null);
});
test('stable activity key and daily idempotency',()=>{
 assert.equal(activityKey({id:'i123'}),'activity:i123');
 assert.equal(scheduledJob(new Date('2026-07-01T06:30:00Z')).key,'morning:2026-07-01');
});
test('telegram chat and sender shape are locked down',()=>{
 assert.equal(authorizedUpdate({message:{chat:{id:123,type:'private'},text:'hi'}},'123'),true);
 assert.equal(authorizedUpdate({message:{chat:{id:456,type:'private'},text:'hi'}},'123'),false);
 assert.equal(authorizedUpdate({message:{chat:{id:123,type:'group'},text:'hi'}},'123'),false);
 assert.equal(authorizedUpdate({edited_message:{chat:{id:123},text:'hi'}},'123'),false);
});
test('weekly Sunday review respects Amsterdam time and stable key',()=>{
 assert.deepEqual(scheduledJob(new Date('2026-07-05T18:00:00Z')), {kind:'weekly',key:'weekly:2026-07-05'});
 assert.deepEqual(scheduledJob(new Date('2026-12-06T19:00:00Z')), {kind:'weekly',key:'weekly:2026-12-06'});
 assert.equal(scheduledJob(new Date('2026-07-06T18:00:00Z')),null);
});
