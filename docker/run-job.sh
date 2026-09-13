#!/bin/bash
# One scheduled job: run its npm scripts in order, log the run with a timestamp
# and whatever Odds API budget is left, and stamp a heartbeat.
#
#   run-job.sh <job>                      # scripts come from the table below
#   run-job.sh <job> <npm-script> [...]   # or name them explicitly
#   CHALK_DRY_RUN=1 run-job.sh <job>      # print what it would run, do nothing
#
# The job name alone is enough, which matters because that is what a person
# types. An earlier version required the scripts as arguments and the crontab
# passed both, so `run-job.sh snapshot snapshot` worked from cron while
# `run-job.sh snapshot` by hand shifted off the only argument, looped over an
# empty list, and reported a clean run having done nothing at all.
#
# Scripts run in sequence and stop at the first failure, which is how the same
# jobs behave as GitHub Actions steps.
set -uo pipefail

# The one place that says what a job does. docker/crontab names jobs from this
# table and nothing else, so the schedule and the runner cannot drift apart.
job_scripts() {
  case "$1" in
    snapshot)     echo "snapshot" ;;
    props)        echo "snapshot:props" ;;
    context)      echo "snapshot:context" ;;
    grade)        echo "grade" ;;
    ingest-games) echo "ingest:games" ;;
    ingest-pbp)   echo "ingest:pbp ingest:players rate" ;;
    *)            return 1 ;;
  esac
}

job_labels() {
  echo "snapshot props context grade ingest-games ingest-pbp"
}

usage() {
  echo "usage: run-job.sh <job> [npm-script ...]" >&2
  echo "jobs:  $(job_labels)" >&2
}

if [ "$#" -eq 0 ]; then
  usage
  exit 2
fi

JOB="$1"; shift

# Defaults are the container's paths; the overrides exist so this can be run
# and tested outside Docker without pretending to be /app.
APP_DIR="${CHALK_APP_DIR:-/app}"
LOG_DIR="${CHALK_LOG_DIR:-/app/logs}"
ENV_FILE="${CHALK_ENV_FILE:-/etc/chalk.env}"
BEAT_DIR="$LOG_DIR/heartbeat"
LOG="$LOG_DIR/$JOB.log"
MAX_LOG_BYTES="${CHALK_MAX_LOG_BYTES:-$((5 * 1024 * 1024))}"

# Explicit scripts win; otherwise look the job up.
if [ "$#" -eq 0 ]; then
  if resolved="$(job_scripts "$JOB")"; then
    # Word splitting is the point here: the table returns a space separated list.
    # shellcheck disable=SC2086
    set -- $resolved
  fi
fi

if [ "${CHALK_DRY_RUN:-}" = "1" ]; then
  if [ "$#" -eq 0 ]; then
    echo "run-job.sh: no scripts for job '$JOB'" >&2
    usage
    exit 2
  fi
  echo "$*"
  exit 0
fi

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

if [ "$#" -eq 0 ]; then
  # Nothing to run is a failure, not a clean run. Reported through the log and
  # the heartbeat like any other, so a mistyped job name leaves a trace in the
  # place someone is already looking rather than only on the terminal.
  status=2
  {
    printf -- '--- no scripts for job %s ---\n' "$JOB"
    printf -- 'Known jobs: %s\n' "$(job_labels)"
    printf -- 'Or name the scripts: run-job.sh %s <npm-script> [...]\n' "$JOB"
  } >> "$out"
else
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
fi

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
