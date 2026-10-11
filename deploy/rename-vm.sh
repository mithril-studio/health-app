#!/usr/bin/env bash
# In-place rename of the boxd VM coach-reachy -> team-endurance, run FROM THE LAPTOP
# (never from inside the VM). Each phase is idempotent and re-runnable:
#
#   deploy/rename-vm.sh preflight
#   deploy/rename-vm.sh backup
#   deploy/rename-vm.sh relocate
#   deploy/rename-vm.sh rename
#   deploy/rename-vm.sh verify
#   deploy/rename-vm.sh cleanup      # only after ~a week of stability
#
# The rename reboots the VM, so run it well away from the 08:30 and 21:00
# Amsterdam report slots. Migration 009 (Telegram removal) is one-way; the
# backup phase takes the dump that protects it. Read README's cutover notes first.
set -euo pipefail

OLD=coach-reachy
NEW=team-endurance
OLD_APP=/opt/$OLD
NEW_APP=/opt/$NEW
PG_IMAGE=postgres:17@sha256:d74eeac9a635390a49bc21bd49fccd973de707e2a53a76ac49b552b8712ec46f
REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
ARTIFACTS=$REPO_ROOT/artifacts
DUMP=$ARTIFACTS/${OLD}-pre-${NEW}.dump

say() { printf '\n=== %s ===\n' "$*"; }

preflight() {
  say "preflight"
  if boxd machine list 2>/dev/null | grep -qw "$NEW"; then
    echo "ABORT: a machine named $NEW already exists." >&2; exit 1
  fi
  echo "Recording current boxd config and proxy list for $OLD (re-apply in verify if the reboot drops them):"
  boxd machine config get "$OLD" || true
  boxd machine proxy list "$OLD" 2>/dev/null || true
  if [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]; then
    echo "ABORT: git tree is not clean; deploy a committed tree." >&2; exit 1
  fi
  # Refuse to start within 20 minutes of a report slot (Amsterdam 08:30 / 21:00).
  local hm; hm=$(TZ=Europe/Amsterdam date +%H:%M)
  case "$hm" in
    08:1[0-9]|08:[2-4][0-9]|20:4[0-9]|20:5[0-9]|21:0[0-9]|21:1[0-9])
      echo "ABORT: $hm Amsterdam is too close to a report slot; wait." >&2; exit 1;;
  esac
  echo "MANUAL: add https://$NEW.boxd.sh/workouts to the WHOOP developer app's redirect URLs now."
  echo "preflight OK (git clean, $NEW free, not in a report window)."
}

backup() {
  say "backup"
  mkdir -p "$ARTIFACTS"
  boxd machine exec "$OLD" -- "docker exec $OLD-postgres pg_dump -Fc -U coach_reachy coach_reachy" > "$DUMP"
  echo "pg_dump -Fc written to $DUMP ($(wc -c <"$DUMP") bytes)."
  boxd machine checkpoint save "$OLD" "pre-$NEW" || echo "checkpoint may already exist; continuing."
  boxd machine backup now "$OLD" || true
  echo "backup OK."
}

relocate() {
  say "relocate (VM still named $OLD)"
  # 1. Stop the old units and the Postgres container.
  boxd machine exec "$OLD" -- "sudo systemctl disable --now $OLD-api $OLD-web $OLD-relay 2>/dev/null || true"
  boxd machine exec "$OLD" -- "docker stop $OLD-postgres || true"
  # 2. Copy the volume into the new name from the pinned image; keep the old volume.
  boxd machine exec "$OLD" -- "docker volume create $NEW-postgres"
  boxd machine exec "$OLD" -- "docker run --rm -v $OLD-postgres:/from -v $NEW-postgres:/to $PG_IMAGE sh -c 'cp -a /from/. /to/'"
  boxd machine exec "$OLD" -- "docker rm $OLD-postgres || true"
  # 3. Move the app root; drop venvs and .next (they embed absolute paths).
  boxd machine exec "$OLD" -- "sudo test -d $NEW_APP || sudo mv $OLD_APP $NEW_APP"
  boxd machine exec "$OLD" -- "sudo rm -rf $NEW_APP/backend/.venv $NEW_APP/ops/.venv $NEW_APP/web/.next"
  # 4. Point the app origin at the new host.
  boxd machine exec "$OLD" -- "sudo sed -i 's#^APP_ORIGIN=.*#APP_ORIGIN=https://$NEW.boxd.sh#' $NEW_APP/.env"
  # 5. Recreate the container/env and redeploy against the moved tree (health checked after rename).
  boxd machine exec "$OLD" -- "cd $NEW_APP && python3 deploy/bootstrap.py"
  VM="$OLD" SKIP_HEALTH=1 "$REPO_ROOT/deploy/update.sh"
  # 6. Remove the old unit files, nginx site and logrotate entry.
  boxd machine exec "$OLD" -- "sudo rm -f /etc/systemd/system/$OLD-api.service /etc/systemd/system/$OLD-web.service /etc/systemd/system/$OLD-relay.service /etc/nginx/sites-available/$OLD /etc/nginx/sites-enabled/$OLD /etc/logrotate.d/$OLD; sudo systemctl daemon-reload"
  # 7. Validate nginx and the loopback health endpoint before the rename.
  boxd machine exec "$OLD" -- "sudo nginx -t && sudo systemctl reload nginx"
  boxd machine exec "$OLD" -- "curl --fail --silent --show-error --max-time 15 http://127.0.0.1:8001/api/health" && echo
  echo "relocate OK; ready to rename."
}

rename() {
  say "rename ($OLD -> $NEW; reboots)"
  boxd machine rename "$OLD" "$NEW" -y
  echo "Waiting for $NEW to report running..."
  for _ in $(seq 1 60); do
    if boxd machine list 2>/dev/null | grep -Eq "\b$NEW\b.*running"; then echo "$NEW is running."; return 0; fi
    sleep 5
  done
  echo "WARNING: $NEW did not report running within the timeout; check boxd." >&2; exit 1
}

verify() {
  say "verify"
  echo "Confirm the boxd config and proxy survived the reboot; re-apply if they did not:"
  boxd machine config get "$NEW" || true
  boxd machine config set "$NEW" bot-protection off || true
  boxd machine config set "$NEW" auto-suspend.timeout 0 || true
  boxd machine config set "$NEW" auto-hibernate.timeout 0 || true
  boxd machine proxy list "$NEW" 2>/dev/null || true
  boxd machine exec "$NEW" -- "systemctl is-active $NEW-api $NEW-web $NEW-relay nginx && docker ps --format '{{.Names}} {{.Status}}' | grep $NEW-postgres"
  curl --fail --silent --show-error --retry 5 --retry-all-errors --retry-delay 3 --max-time 20 "https://$NEW.boxd.sh/api/health" && echo
  echo "Set BOX_URL=https://$NEW.boxd.sh in the local .env, then run the external smoke checks:"
  python3 "$REPO_ROOT/deploy/smoke.py" --url "https://$NEW.boxd.sh" || true
  python3 "$REPO_ROOT/deploy/smoke.py" --url "https://$NEW.boxd.sh" --chat || true
  node "$REPO_ROOT/deploy/browser-smoke.mjs" || true
  boxd machine exec "$NEW" -- "$NEW_APP/ops/.venv/bin/python $NEW_APP/ops/relay.py --dry-run" || true
  echo "verify complete; also re-point MCP clients to https://$NEW.boxd.sh/mcp, sign in again, and re-test Connect WHOOP."
}

cleanup() {
  say "cleanup (only after ~a week of stability)"
  boxd machine exec "$NEW" -- "docker volume rm $OLD-postgres || true"
  boxd machine checkpoint delete "$NEW" "pre-$NEW" || true
  rm -f "$DUMP"
  echo "Old volume, checkpoint and dump removed. Delete deploy/rename-vm.sh in a follow-up commit."
}

case "${1:-}" in
  preflight|backup|relocate|rename|verify|cleanup) "$1";;
  *) echo "usage: $0 {preflight|backup|relocate|rename|verify|cleanup}" >&2; exit 2;;
esac
