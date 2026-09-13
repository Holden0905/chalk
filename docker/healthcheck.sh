#!/bin/bash
# Healthy means something has run recently. The most frequent job is the daily
# 9:17am snapshot, so anything past 26 hours means a whole day was missed.
set -euo pipefail

BEAT="${CHALK_LOG_DIR:-/app/logs}/heartbeat.txt"
STALE_AFTER=$((26 * 3600))

[ -f "$BEAT" ] || { echo "no heartbeat yet"; exit 1; }

last="$(grep -oE '^finished_epoch=[0-9]+' "$BEAT" | cut -d= -f2)"
[ -n "$last" ] || { echo "heartbeat has no timestamp"; exit 1; }

age=$(( $(date +%s) - last ))
if [ "$age" -gt "$STALE_AFTER" ]; then
  echo "last run was $((age / 3600))h ago"
  exit 1
fi
echo "last run $((age / 60))m ago"
