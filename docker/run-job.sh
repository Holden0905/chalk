#!/bin/bash
# One scheduled job: run one or more npm scripts in order, log the run with a
# timestamp and whatever Odds API budget is left, and stamp a heartbeat.
#
#   run-job.sh <label> <npm-script> [npm-script ...]
#
# Scripts run in sequence and stop at the first failure, which is how the same
# jobs behave as GitHub Actions steps.
set -uo pipefail

JOB="$1"; shift

# Defaults are the container's paths; the overrides exist so this can be run
# and tested outside Docker without pretending to be /app.
APP_DIR="${CHALK_APP_DIR:-/app}"
LOG_DIR="${CHALK_LOG_DIR:-/app/logs}"
ENV_FILE="${CHALK_ENV_FILE:-/etc/chalk.env}"
BEAT_DIR="$LOG_DIR/heartbeat"
LOG="$LOG_DIR/$JOB.log"
MAX_LOG_BYTES="${CHALK_MAX_LOG_BYTES:-$((5 * 1024 * 1024))}"

mkdir -p "$LOG_DIR" "$BEAT_DIR"

# Written by the entrypoint, because cron hands a job almost no environment.
if [ -r "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ENV_FILE"
  set +a
fi

cd "$APP_DIR" || exit 1

# Keep a single run's log bounded. One generation back is enough to see what
# happened last week without letting the NAS fill up.
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt "$MAX_LOG_BYTES" ]; then
  mv -f "$LOG" "$LOG.1"
fi

started="$(date '+%Y-%m-%d %H:%M:%S %Z')"
start_epoch="$(date +%s)"

out="$(mktemp)"
trap 'rm -f "$out"' EXIT

status=0
failed=""
for script in "$@"; do
  printf -- '--- npm run %s ---\n' "$script" >> "$out"
  # Deliberately not `if ! npm run ...`: inside a negated condition $? is the
  # status of the negation, which is 0 precisely when the command failed. That
  # reads as a clean run in the heartbeat, which is the one field worth
  # alerting on, so the status is captured before anything can touch it.
  npm run --silent "$script" >> "$out" 2>&1
  rc=$?
  if [ "$rc" -ne 0 ]; then
    status=$rc
    failed="$script"
    printf -- '--- %s FAILED, exit %s; later steps skipped ---\n' "$script" "$rc" >> "$out"
    break
  fi
done

finished="$(date '+%Y-%m-%d %H:%M:%S %Z')"
elapsed=$(( $(date +%s) - start_epoch ))

# snapshot, grade and snapshot:props each print this; the nflverse and ESPN
# jobs spend no Odds API budget and print nothing, which reads as n/a.
remaining="$(grep -oE 'x-requests-remaining: *[0-9]+' "$out" | tail -1 | grep -oE '[0-9]+$')"
[ -n "$remaining" ] || remaining="n/a"

{
  printf '===== %s  started %s\n' "$JOB" "$started"
  cat "$out"
  printf '===== %s  finished %s  exit=%s  %ss  x-requests-remaining=%s\n\n' \
    "$JOB" "$finished" "$status" "$elapsed" "$remaining"
} >> "$LOG"

# Per job, so a single stale job is visible rather than hidden behind the
# others still running.
{
  printf 'job=%s\n' "$JOB"
  printf 'finished=%s\n' "$finished"
  printf 'finished_epoch=%s\n' "$(date +%s)"
  printf 'exit=%s\n' "$status"
  printf 'elapsed_seconds=%s\n' "$elapsed"
  printf 'requests_remaining=%s\n' "$remaining"
  printf 'scripts=%s\n' "$*"
  [ -n "$failed" ] && printf 'failed_step=%s\n' "$failed"
} > "$BEAT_DIR/$JOB"

# One file that answers "is anything running at all", whichever job it was.
cp -f "$BEAT_DIR/$JOB" "$LOG_DIR/heartbeat.txt"

# Cron would otherwise try to mail a job's output and silently drop it. Writing
# the one-line summary to PID 1's stdout puts it in `docker logs` instead.
summary="$(printf '%s  %s  exit=%s  %ss  requests_remaining=%s' \
  "$finished" "$JOB" "$status" "$elapsed" "$remaining")"
if [ -w /proc/1/fd/1 ]; then
  echo "$summary" > /proc/1/fd/1
fi

exit "$status"
