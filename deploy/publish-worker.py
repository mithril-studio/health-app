#!/usr/bin/env python3
"""Deploy to the logged-in Cloudflare account; never prints secret values.

Does NOT switch Telegram transport or suspend the VM. Follow README's cutover
steps after verifying the deployed Worker URL.
"""
import json
import re
import subprocess
from pathlib import Path

root=Path(__file__).resolve().parents[1]
worker=root/'worker'

def wrangler(*args, input=None):
    return subprocess.run(['npx','--no-install','wrangler',*args],cwd=worker,input=input,text=True,capture_output=True,check=True)

try:
    auth=wrangler('whoami').stdout
    if 'not authenticated' in auth.lower():
        raise RuntimeError('Run cd worker && npx wrangler login first.')
    config_path=worker/'wrangler.jsonc'
    config=json.loads(config_path.read_text())
    if config['kv_namespaces'][0]['id'].startswith('REPLACE_'):
        namespaces=json.loads(wrangler('kv','namespace','list').stdout)
        existing=next((n for n in namespaces if n['title']=='coach-reachy-STATE'),None)
        if existing:
            namespace_id=existing['id']
        else:
            result=wrangler('kv','namespace','create','STATE').stdout
            match=re.search(r'"id"\s*:\s*"([a-f0-9]+)"',result)
            if not match:
                raise RuntimeError('Namespace created; inspect wrangler namespace list to set its ID.')
            namespace_id=match.group(1)
        config['kv_namespaces'][0]['id']=namespace_id
        config_path.write_text(json.dumps(config,indent=2)+'\n')
    # Upload secrets before adding live schedules. Worker requires all five.
    values={}
    for line in (root/'.env').read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k,v=line.split('=',1);values[k]=v.strip().strip('\"').strip("'")
    keys=['INTERVALS_API_KEY','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','TELEGRAM_WEBHOOK_SECRET','BOX_SHARED_SECRET']
    if any(not values.get(k) for k in keys):
        raise RuntimeError('Missing required Worker secret in .env')
    wrangler('secret','bulk',input=json.dumps({k:values[k] for k in keys}))
    result=wrangler('deploy')
    urls=re.findall(r'https://[a-zA-Z0-9.-]+\.workers\.dev',result.stdout)
    print('Worker deployed.',urls[-1] if urls else 'Check Cloudflare dashboard for URL.')
    print('Secrets uploaded. Telegram remains on VM polling until explicit cutover; see README.')
except subprocess.CalledProcessError as error:
    # CLI may include config context; don't dump raw output with potential secrets.
    raise SystemExit(f'Wrangler failed (exit {error.returncode}). Check authentication and account permissions.')
except RuntimeError as error:
    raise SystemExit(str(error))
