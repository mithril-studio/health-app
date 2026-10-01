import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCurves } from '../src/lib/data';

test('pace curves accept the verified Intervals distance/values wire format', () => {
  // Synthetic values, actual upstream field names verified with a read-only request.
  assert.deepEqual(normalizeCurves({list:[{distance:[1000,5000,10000],values:[200,1100,null]}]}, 'Run'), [
    {x:1000,value:200}, {x:5000,value:220},
  ]);
});
