#!/usr/bin/env python3
"""Run on the private VM after uploading source and .env. Never print secrets."""
import os
import subprocess
from pathlib import Path
from urllib.parse import urlparse, unquote

root=Path('/opt/coach-reachy')
values={}
for line in (root/'.env').read_text().splitlines():
    if line.strip() and not line.startswith('#') and '=' in line:
        k,v=line.split('=',1)
        values[k.strip()]=v.strip().strip('\"').strip("'")
url=urlparse(values['DATABASE_URL'])
env_path=root/'.postgres.env'
env_path.write_text(f'POSTGRES_DB={url.path[1:]}\nPOSTGRES_USER={unquote(url.username or "reachy")}\nPOSTGRES_PASSWORD={unquote(url.password or "")}\n')
os.chmod(env_path,0o600)
subprocess.run(['docker','volume','create','coach-reachy-postgres'],check=True)
exists=subprocess.run(['docker','container','inspect','coach-reachy-postgres'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0
if not exists:
    subprocess.run(['docker','run','-d','--name','coach-reachy-postgres','--restart','unless-stopped','--env-file',str(env_path),'-p','127.0.0.1:5432:5432','-v','coach-reachy-postgres:/var/lib/postgresql/data','postgres:17'],check=True)
else:
    subprocess.run(['docker','start','coach-reachy-postgres'],check=True)
subprocess.run(['sudo','chown','root:root',str(root/'.env'),str(env_path)],check=True)
subprocess.run(['sudo','chmod','600',str(root/'.env'),str(env_path)],check=True)
print('Postgres configured on loopback; environment files locked to root.')
