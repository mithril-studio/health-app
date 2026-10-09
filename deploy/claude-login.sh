#!/usr/bin/env bash
# Re-authenticate the coach's isolated Claude login on the VM.
#
# Run this inside an interactive shell on the machine (`boxd connect coach-reachy`),
# because the official CLI prints a sign-in URL and asks for the resulting code.
# It touches only the service-owned credential directory, never your own ~/.claude.
# Afterwards the API is restarted so queued Telegram replies and reports resume.
set -euo pipefail
DIR=${CLAUDE_CONFIG_DIR:-/opt/coach-reachy/claude-auth}
run_cli() {
  sudo -u boxd env -i \
    PATH=/usr/local/bin:/usr/bin:/bin HOME=/home/boxd CLAUDE_CONFIG_DIR="$DIR" \
    DISABLE_AUTOUPDATER=1 DISABLE_TELEMETRY=1 DISABLE_ERROR_REPORTING=1 \
    claude "$@"
}
echo "Signing in to the coach's Claude login in $DIR"
run_cli auth login
run_cli auth status
sudo chmod 600 "$DIR/.credentials.json"
sudo systemctl restart coach-reachy-api
sleep 3
systemctl is-active coach-reachy-api
echo "Done. Queued coach work resumes automatically; run python3 deploy/smoke.py --chat from your laptop to verify a real reply."
