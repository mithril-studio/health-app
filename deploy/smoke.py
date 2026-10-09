#!/usr/bin/env python3
"""Read-only live verification. Secrets stay in memory; no health payloads printed."""
import argparse
import http.cookiejar
import json
import time
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path

p=argparse.ArgumentParser()
p.add_argument('--url',default='https://coach-reachy.boxd.sh')
p.add_argument('--env',default=str(Path(__file__).resolve().parents[1]/'.env'))
p.add_argument('--chat',action='store_true',help='Run one read-only OpenRouter coaching conversation')
args=p.parse_args()
values={}
for line in Path(args.env).read_text().splitlines():
    if '=' in line and not line.startswith('#'):
        k,v=line.split('=',1);values[k]=v.strip().strip('\"').strip("'")
jar=http.cookiejar.CookieJar()
client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

def request(path, body=None, token=None, anonymous=False, extra_headers=None):
    headers={'Content-Type':'application/json','Origin':args.url,**(extra_headers or {})}
    if token:headers['Authorization']='Bearer '+token
    req=urllib.request.Request(args.url+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
    try:
        with (urllib.request.urlopen(req,timeout=220) if anonymous else client.open(req,timeout=220)) as response:
            raw=response.read().decode()
            try:data=json.loads(raw)
            except ValueError:data=raw
            return response.status,data
    except urllib.error.HTTPError as error:
        return error.code, None

for path in ['/api/dashboard','/api/chat','/mcp']:
    status,_=request(path,anonymous=True)
    assert status in (401,403),f'Unprotected route {path}: {status}'
print('PASS private data and MCP reject anonymous requests')
status,_=request('/api/internal/job',{'kind':'morning','key':'unauthorized-smoke'},anonymous=True)
assert status in (401,403),f'Internal job guard: {status}'
status,_=request('/api/login',{'password':values['APP_PASSWORD']})
assert status==200,f'Login: {status}'
print('PASS login creates session')
status,data=request('/api/dashboard?oldest='+str(date.today()-timedelta(days=365))+'&newest='+str(date.today()+timedelta(days=30)))
assert status==200,f'Dashboard: {status}'
assert isinstance(data.get('activities'),list) and isinstance(data.get('wellness'),list)
print('PASS cached dashboard:',{key:len(data.get(key,[])) for key in ['activities','events','wellness','fitness']})
print('Sync status:',{'last_success':data.get('sync',{}).get('last_success'),'error':data.get('sync',{}).get('error')})
status,mcp=request('/mcp',{'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2025-03-26','capabilities':{},'clientInfo':{'name':'reachy-smoke','version':'1.0'}}},token=values['MCP_AUTH_TOKEN'],anonymous=True,extra_headers={'Accept':'application/json, text/event-stream'})
assert status==200,f'MCP initialize: {status}'
print('PASS authenticated MCP initialize')
status,tools=request('/mcp',{'jsonrpc':'2.0','id':2,'method':'tools/list','params':{}},token=values['MCP_AUTH_TOKEN'],anonymous=True,extra_headers={'Accept':'application/json, text/event-stream','MCP-Protocol-Version':'2025-03-26'})
assert status==200,f'MCP tools: {status}'
if isinstance(tools,dict):
    names=[tool['name'] for tool in tools.get('result',{}).get('tools',[])]
    assert 'get_calendar' in names and 'move_workout' in names
    print('PASS MCP tools:',len(names))
else:
    assert 'get_calendar' in tools
    print('PASS MCP tool catalog (SSE)')
if args.chat:
    status,history=request('/api/chat')
    assert status==200 and history.get('agent',{}).get('transport')=='openrouter', 'Chat must use OpenRouter'
    assert history['agent']['configured'], 'OpenRouter must be configured'
    curve_status,curves=request('/api/curves?sport=Run&period=84')
    assert curve_status==200, f'Pace curve: {curve_status}'
    measured=None
    for curve in curves.get('list',[]):
        if 5000 in curve.get('distance',[]):
            index=curve['distance'].index(5000)
            measured=curve['values'][index]
            break
    started=time.monotonic()
    status,result=request('/api/chat',{'message':'Use the get_curves tool with sport Run and period 84. Report my measured best 5000 metre effort, if available, in m:ss format. Then give one concise recovery-aware suggestion using my recent wellness data. State missing data and do not modify any workouts or settings.'})
    assert status==200 and result.get('reply'),f'Chat: {status}'
    if measured:
        seconds=round(measured)
        expected=f'{seconds//60}:{seconds%60:02}'
        assert expected in result['reply'], 'Coaching reply must report the measured 5 km tool result'
    print('PASS OpenRouter tool coaching matches measured pace data:',len(result['reply']),'characters;',round(time.monotonic()-started,1),'seconds')
status,_=request('/api/logout',{})
assert status in (200,204)
status,_=request('/api/dashboard')
assert status in (401,403)
print('PASS logout revokes browser access')
