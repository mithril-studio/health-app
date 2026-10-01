import asyncio
from datetime import date

import pytest

from coach.tools import ToolService, ToolError
from test_persistence import Source


class WritableSource(Source):
    configured=True
    def __init__(self):
        super().__init__()
        self.event_data={'id':21,'category':'WORKOUT','name':'Easy','start_date_local':'2026-10-01T10:00:00'}
        self.calls=[]
    async def event(self,id): return dict(self.event_data)
    async def request(self,method,path,**kwargs):
        self.calls.append((method,path,kwargs))
        if method=='DELETE': return {}
        self.event_data.update(kwargs.get('json',{}))
        return dict(self.event_data)


@pytest.fixture
async def tool_service(store):
    source=WritableSource()
    return ToolService(store,source,telegram_configured=True)


async def test_delete_request_never_deletes_and_confirmation_only_once(tool_service,store):
    result=await tool_service.call('delete_workout',{'id':'21'},operation_key='user1')
    assert result['pending_confirmation'] is True and 'token' not in result
    assert tool_service.source.calls==[]
    pending=await tool_service.pending_deletions()
    token=pending[0]['token']
    results=await asyncio.gather(*(tool_service.confirm_delete(token) for _ in range(5)))
    assert all(r['status']=='done' for r in results)
    assert [r[0] for r in tool_service.source.calls]==['DELETE']
    assert len(await store.query('SELECT * FROM write_audit'))==2
    assert len(await store.query("SELECT * FROM work_items WHERE kind='notification'"))==1


async def test_delete_expiry_and_changed_event_require_new_confirmation(tool_service,store):
    await tool_service.call('delete_workout',{'id':'21'})
    token=(await tool_service.pending_deletions())[0]['token']
    tool_service.source.event_data['name']='Changed remotely'
    with pytest.raises(ToolError): await tool_service.confirm_delete(token)
    assert tool_service.source.calls==[]
    await store.execute("UPDATE pending_deletions SET expires_at=now()-interval '1 minute'")
    with pytest.raises(ToolError): await tool_service.confirm_delete(token)


async def test_model_cannot_confirm_or_write_scheduled_advice(tool_service):
    for name,args in [('confirm_delete',{'token':'x'}),('delete_workout',{'id':'21','confirmed':True})]:
        with pytest.raises(ValueError): await tool_service.call(name,args)
    with pytest.raises(ToolError):
        await tool_service.call('plan_workout',{'date':'2026-10-01','name':'X','sport':'Run','description':'- 10m Z2'},read_only=True)
    assert tool_service.source.calls==[]


async def test_write_replay_is_idempotent_and_refreshes_cache(tool_service,store):
    args={'id':'21','date':'2026-10-03'}
    result=await tool_service.call('move_workout',args,operation_key='tg:7:move')
    again=await tool_service.call('move_workout',args,operation_key='tg:7:move')
    assert result==again and len(tool_service.source.calls)==1
    assert tool_service.source.calls[0][2]['json']=={'start_date_local':'2026-10-03T10:00:00'}
    assert (await store.get('events','21'))['start_date_local']=='2026-10-03T10:00:00'
    with pytest.raises(ToolError):
        await tool_service.call('move_workout',{'id':'21','date':'2026-10-04'},operation_key='tg:7:move')


async def test_read_tools_use_cache_without_remote_requests(tool_service,store):
    await store.put('activities','a',{'id':'a','type':'Run','start_date_local':'2026-10-01'},date(2026,10,1))
    await store.put('activity_intervals','a',{'icu_intervals':[]})
    assert (await tool_service.call('get_activity',{'id':'a'}))['id']=='a'
    assert tool_service.source.calls==[]
