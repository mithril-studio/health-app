#!/usr/bin/env bash
# Update the existing private VM. Does not transfer OAuth credentials or change secrets.
set -euo pipefail
cd "$(dirname "$0")/.."
VM=${VM:-team-endurance}
APP=/opt/team-endurance
URL=${URL:-https://$VM.boxd.sh}
archive=$(mktemp /tmp/team-endurance-release.XXXXXX)
trap 'rm -f "$archive"' EXIT
paths=(backend/coach backend/migrations backend/requirements.txt
  web/src web/package.json web/package-lock.json web/next.config.ts web/next-env.d.ts web/tsconfig.json web/.npmrc
  ops/ deploy/)
# Static assets are optional: a fresh checkout has no web/public yet.
[ -d web/public ] && paths+=(web/public)
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$archive" \
  --exclude='._*' --exclude='__pycache__' --exclude='.venv' --exclude='.pytest_cache' \
  "${paths[@]}"
boxd machine cp "$archive" "$VM:/tmp/team-endurance-release.tar.gz"
# tar is additive, so prune the fully-repo-managed source dirs first; otherwise files
# deleted from the repo linger on the VM and can break the build (e.g. a removed .ts).
# Venvs (backend/.venv, ops/.venv) and web/node_modules/.next live outside these and survive.
boxd machine exec "$VM" -- "rm -rf $APP/web/src $APP/backend/coach $APP/backend/migrations $APP/deploy"
boxd machine exec "$VM" -- "tar -xzf /tmp/team-endurance-release.tar.gz -C $APP"
# Create the service venvs on first deploy (e.g. after a relocate); reuse them afterwards.
boxd machine exec "$VM" -- "test -x $APP/backend/.venv/bin/python || python3 -m venv $APP/backend/.venv"
boxd machine exec "$VM" -- "test -x $APP/ops/.venv/bin/python || python3 -m venv $APP/ops/.venv"
boxd machine exec "$VM" -- "cd $APP/backend && uv pip install --python .venv/bin/python --only-binary :all: -r requirements.txt"
boxd machine exec "$VM" -- "cd $APP/ops && uv pip install --python .venv/bin/python --only-binary :all: -r requirements.txt"
boxd machine exec "$VM" -- "cd $APP/web && npm ci --ignore-scripts --no-fund --no-audit && NEXT_TELEMETRY_DISABLED=1 npm run build"
boxd machine exec "$VM" -- "sudo cp $APP/deploy/team-endurance-*.service $APP/ops/team-endurance-relay.service /etc/systemd/system/; sudo cp $APP/deploy/logrotate.conf /etc/logrotate.d/team-endurance; sudo systemctl daemon-reload; sudo systemctl enable team-endurance-api team-endurance-web team-endurance-relay; sudo systemctl restart team-endurance-api team-endurance-web team-endurance-relay"
boxd machine exec "$VM" -- "sudo cp $APP/deploy/nginx.conf /etc/nginx/sites-available/team-endurance; sudo ln -sf /etc/nginx/sites-available/team-endurance /etc/nginx/sites-enabled/team-endurance; sudo nginx -t && sudo systemctl reload nginx"
if [ "${SKIP_HEALTH:-}" != 1 ]; then
  curl --fail --silent --show-error --retry 5 --retry-all-errors --retry-delay 2 --max-time 15 "$URL/api/health"
fi
printf '\nUpdated. Run python3 deploy/smoke.py and node deploy/browser-smoke.mjs.\n'
