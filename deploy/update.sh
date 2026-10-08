#!/usr/bin/env bash
# Update the existing private VM. Does not transfer OAuth credentials or change secrets.
set -euo pipefail
cd "$(dirname "$0")/.."
VM=coach-reachy
archive=$(mktemp /tmp/coach-reachy-release.XXXXXX)
trap 'rm -f "$archive"' EXIT
release_paths=(
  backend/coach backend/migrations backend/requirements.txt
  web/src web/package.json web/package-lock.json web/next.config.ts web/next-env.d.ts web/tsconfig.json web/.npmrc
  ops/ deploy/
)
if [[ -d web/public ]]; then
  release_paths+=(web/public)
fi
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$archive" \
  --exclude='._*' --exclude='__pycache__' --exclude='.venv' --exclude='.pytest_cache' \
  "${release_paths[@]}"
boxd machine cp "$archive" "$VM:/tmp/coach-reachy-release.tar.gz"
boxd machine exec "$VM" -- 'tar -xzf /tmp/coach-reachy-release.tar.gz -C /opt/coach-reachy'
boxd machine exec "$VM" -- 'cd /opt/coach-reachy/backend && uv pip install --python .venv/bin/python --only-binary :all: -r requirements.txt'
boxd machine exec "$VM" -- 'cd /opt/coach-reachy/ops && uv pip install --python .venv/bin/python --only-binary :all: -r requirements.txt'
boxd machine exec "$VM" -- 'cd /opt/coach-reachy/web && npm ci --ignore-scripts --no-fund --no-audit && NEXT_TELEMETRY_DISABLED=1 npm run build'
boxd machine exec "$VM" -- 'sudo cp /opt/coach-reachy/deploy/coach-reachy-*.service /opt/coach-reachy/ops/coach-reachy-relay.service /etc/systemd/system/; sudo cp /opt/coach-reachy/deploy/logrotate.conf /etc/logrotate.d/coach-reachy; sudo systemctl daemon-reload; sudo systemctl restart coach-reachy-api coach-reachy-web; if systemctl is-active --quiet coach-reachy-relay; then sudo systemctl restart coach-reachy-relay; fi'
boxd machine exec "$VM" -- 'sudo cp /opt/coach-reachy/deploy/nginx.conf /etc/nginx/sites-available/coach-reachy; sudo nginx -t && sudo systemctl reload nginx'
curl --fail --silent --show-error --retry 5 --retry-all-errors --retry-delay 2 --max-time 15 https://coach-reachy.boxd.sh/api/health
printf '\nUpdated. Run python3 deploy/smoke.py and node deploy/browser-smoke.mjs.\n'
