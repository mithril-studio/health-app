import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDashboard } from '../src/lib/data';
import { restrictedCount } from '../src/lib/source-info';

test('only explicitly source-restricted records count toward the data warning', () => {
  const data = normalizeDashboard({activities:[
    {id:'a',start_date_local:'2026-10-01',source:'STRAVA',_note:'STRAVA activities are not available via the API'},
    {id:'b',start_date_local:'2026-10-01',type:'Run',name:'Direct upload'},
    {id:'c',start_date_local:'2026-10-01'},
  ]});
  assert.equal(restrictedCount(data),1);
  assert.equal(restrictedCount(normalizeDashboard({activities:[]})),0);
});
