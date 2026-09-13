#!/bin/bash
# Container start: fix the clock, hand the environment to cron, then hand over
# to cron itself as PID 1.
set -euo pipefail

LOG_DIR=/app/logs

# Cron reads /etc/localtime, not $TZ, so a TZ passed in by compose has to be
# written through or every job would fire on UTC.
if [ -n "${TZ:-}" ] && [ -f "/usr/share/zoneinfo/$TZ" ]; then
  ln -snf "/usr/share/zoneinfo/$TZ" /etc/localtime
  echo "$TZ" > /etc/timezone
fi

mkdir -p "$LOG_DIR" "$LOG_DIR/heartbeat"

# Cron deliberately starts its jobs with an almost empty environment: it does
# NOT inherit the container's, so the three keys compose put there are invisible
# to a job unless they are written somewhere the job can read. This file is that
# somewhere. Mode 600, inside the container only, never in the image, and every
# value is single-quote escaped so a key containing a shell metacharacter cannot
# break the sourcing.
umask 077
ENV_FILE=/etc/chalk.env
: > "$ENV_FILE"

missing=0
for name in SUPABASE_URL SUPABASE_SERVICE_KEY ODDS_API_KEY; do
  value="$(printenv "$name" || true)"
  if [ -z "$value" ]; then
    # Names only. The values are never printed, here or anywhere else.
    echo "chalk-cron: WARNING $name is not set; jobs needing it will fail" >&2
    missing=$((missing + 1))
    continue
  fi
  printf "%s='%s'\n" "$name" "$(printf '%s' "$value" | sed "s/'/'\\\\''/g")" >> "$ENV_FILE"
done
chmod 600 "$ENV_FILE"

if [ "$missing" -gt 0 ]; then
  echo "chalk-cron: $missing of 3 keys missing. Check that .env sits beside docker-compose.yml." >&2
fi

crontab /app/docker/crontab

echo "chalk-cron: up at $(date '+%Y-%m-%d %H:%M:%S %Z'), $(( $(crontab -l | grep -cv '^\s*\(#\|$\)') )) jobs scheduled"
crontab -l | grep -v '^\s*\(#\|$\)' | sed 's/^/chalk-cron:   /'

# Foreground, so the container lives as long as cron does and Docker can restart
# it if cron ever dies.
exec cron -f
