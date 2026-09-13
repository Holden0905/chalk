# Chalk

NFL odds and results tracker. `README.md` is the reference: tables, the rating,
the backtest, the TD finder, the bet log, the web app. This file is the part
that is not derivable from the code.

## Where the scheduled captures run

**Defiant is primary. GitHub Actions is the fallback.**

Defiant is Brian's UGOS NAS, running `docker-compose.yml` at the repo root as a
single `chalk-cron` container: the repo-root ingest scripts plus a cron daemon,
scheduled in `docker/crontab` on America/Chicago time. `RUNBOOK.md` covers
installing it, reading the logs and the heartbeat, and updating after a pull.

The workflows in `.github/workflows/` are the same jobs on the same cadence, and
they stay in the repo so there is something to fall back to when Defiant is down
or being rebuilt. Treat them as a spare, not as the source of truth: change a
schedule in `docker/crontab` first, and mirror it into the workflow only if it
matters that the fallback matches.

Two things follow from that split:

- **Central time beats UTC for this.** Defiant's crontab is in America/Chicago,
  which is always exactly one hour behind Eastern, so every capture holds its
  position against kickoff year round. The Actions crons are pinned to UTC and
  slip an hour when US clocks change on Nov 1. If the two ever disagree about
  when a capture should happen, `docker/crontab` is right.
- **Both running at once costs real money.** During CDT the two schedules fire
  on the same minute, which duplicates rows in `chalk_odds_snapshots` and
  `chalk_prop_snapshots` and spends Odds API credits twice. `gh workflow disable`
  the four workflows once Defiant is trusted; `workflow_dispatch` still works
  while a workflow is disabled, so the fallback survives. See the last section of
  `RUNBOOK.md`.

## Secrets

`SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and `ODDS_API_KEY` live in a `.env` that
is never committed and never enters a Docker image — `.gitignore` and
`.dockerignore` both exclude it, and compose reads it from the host at run time.
Do not print their values into logs, commit messages or terminal output; the
scripts and the container entrypoint only ever name a variable, never show it.

The web app under `web/` has its own `.env.local` and its own deploy on Vercel.
Nothing in the container touches it.
