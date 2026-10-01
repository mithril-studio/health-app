import asyncio
from datetime import date

import pytest

from coach.sync import SyncService


class Source:
    def __init__(self):
        self.fail = False
        self.events = [{'id':21,'start_date_local':'2026-10-01T10:00:00','category':'WORKOUT'}]
        self.ranges=[]
    async def activities(self, oldest, newest):
        self.ranges.append((oldest,newest))
        return [{'id':'a','start_date_local':'2026-10-01T10:00:00','type':'Run'}]
    async def wellness(self, oldest, newest):
        if self.fail: raise RuntimeError('upstream sensitive response must not persist')
        return [{'id':'2026-10-01','ctl':30,'atl':40}]
    async def events_range(self, oldest, newest): return self.events
    async def settings(self): return [{'id':1,'types':['Run'],'threshold_pace':4.0}]


async def test_sync_atomic_and_deleted_events_removed(store):
    source=Source()
    sync=SyncService(store,source)
    await sync.run(today=date(2026,10,1))
    assert source.ranges[0][0] == date(2025,10,1)
    first=await store.sync_status()
    assert first['last_success'] is not None and first['error'] is None
    assert len(await store.range('events',date(2026,10,1),date(2026,10,1)))==1
    source.events=[]
    source.fail=True
    with pytest.raises(RuntimeError): await sync.run(today=date(2026,10,2))
    failed=await store.sync_status()
    assert failed['last_success']==first['last_success']
    assert 'sensitive' not in failed['error']
    assert len(await store.range('events',date(2026,10,1),date(2026,10,1)))==1
    source.fail=False
    await sync.run(today=date(2026,10,2))
    assert await store.range('events',date(2026,10,1),date(2026,10,1))==[]
    assert (await store.range('fitness_daily',date(2026,10,1),date(2026,10,1)))[0]['form']==-10
    assert source.ranges[-1][0]==date(2026,9,24)


async def test_durable_dedup_is_concurrent_safe_and_failed_attempt_retries(store):
    await asyncio.gather(*(store.enqueue('telegram:123','telegram',{'text':'hello'}) for _ in range(8)))
    attempts=[]
    async def failing(key,payload):
        attempts.append(1)
        await asyncio.sleep(.04)
        raise RuntimeError('never save this private payload')
    results=await asyncio.gather(*(store.process('telegram:123',failing) for _ in range(8)))
    assert len(attempts)==1
    state=await store.work_status('telegram:123')
    assert state['status']=='retry' and state['attempts']==1
    assert state['error']=='RuntimeError'
    async with store.pool.connection() as c:
        await c.execute("UPDATE work_items SET available_at=now() WHERE key='telegram:123'")
    async def successful(key,payload):
        attempts.append(1)
        return {'ok':True}
    await asyncio.gather(*(store.process('telegram:123',successful) for _ in range(8)))
    assert len(attempts)==2
    assert (await store.work_status('telegram:123'))['status']=='succeeded'
    await store.process('telegram:123',successful)
    assert len(attempts)==2


async def test_duplicate_key_cannot_replace_payload(store):
    await store.enqueue('job:x','job',{'kind':'morning'})
    with pytest.raises(ValueError):
        await store.enqueue('job:x','job',{'kind':'evening'})
