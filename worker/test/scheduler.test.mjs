import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scheduledJob, activityKey} from '../src/index.mjs';
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
