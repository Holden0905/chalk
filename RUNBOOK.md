# Runbook: Chalk captures on Defiant

Defiant (UGOS NAS, Docker) is where Chalk's scheduled captures run. One
container, `chalk-cron`: the repo-root ingest scripts plus a cron daemon, on
Central time. The GitHub Actions workflows are still in the repo as a fallback —
see **Actions is a fallback, and right now it double-runs** at the bottom, which
is the one thing to deal with on day one.

Nothing here touches `web/`. The site is on Vercel and is unaffected.

## What runs, and when

Times are America/Chicago. Because Central is always exactly one hour behind
Eastern, these hold their position against kickoff all season — unlike the
Actions crons, which are pinned to UTC and slip an hour when the clocks change
on Nov 1.

| When | Job | Scripts |
| --- | --- | --- |
| daily 9:17am | `snapshot` | `snapshot` |
| Sun 11:19am, 2:49pm, 6:49pm | `snapshot` | `snapshot` |
| Thu 6:49pm, Mon 6:49pm | `snapshot` | `snapshot` |
| Sat 9:37am | `props` | `snapshot:props` |
| Sat 9:40am, Sun 9:40am | `context` | `snapshot:context` |
| Tue 7:23am, Fri 7:23am | `grade` | `grade` |
| Tue 8:20am | `ingest-games` | `ingest:games` |
| Tue 8:23am | `ingest-pbp` | `ingest:pbp`, then `ingest:players`, then `rate` |

The three night captures land 7:49pm ET, 26 to 31 minutes before a TNF, SNF or
MNF kickoff. The chained Tuesday job stops at the first failure, so a bad
`ingest:pbp` will not go on to rate teams off stale weeks.

Schedules live in `docker/crontab`. Change them there and rebuild.

## First install

On Defiant, over SSH:

```bash
mkdir -p /volume1/docker && cd /volume1/docker
git clone https://github.com/Holden0905/chalk.git
cd chalk
```

Put the three keys in a `.env` beside `docker-compose.yml`. Copy it from the
machine that already has one rather than retyping it:

```bash
# from your laptop
scp .env defiant:/volume1/docker/chalk/.env
```

It needs exactly these three, one per line, no `export`, no quotes:

```
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
ODDS_API_KEY=...
```

`.env` is in `.gitignore` and in `.dockerignore`, so it is never committed and
never baked into the image. Compose reads it at `up` time and passes the values
in as environment.

Then:

```bash
docker compose up -d --build
```

First build pulls `node:22-bookworm-slim` and runs `npm ci`; a minute or two.

Confirm it came up with all three keys:

```bash
docker compose logs chalk-cron
```

You want the `chalk-cron: up at ...` line followed by 13 scheduled jobs. A
`WARNING <NAME> is not set` line means `.env` is missing or misspelt — only the
variable name is ever printed, never the value.

## Checking on it

**Is it alive?** The container is healthy when something has run in the last 26
hours, which the daily 9:17am snapshot guarantees:

```bash
docker compose ps
```

**What ran last, of anything:**

```bash
cat logs/heartbeat.txt
```

```
job=snapshot
finished=2026-09-13 09:17:04 CDT
finished_epoch=1789301824
exit=0
elapsed_seconds=6
requests_remaining=431
scripts=snapshot
```

`exit=0` is the field to care about. `requests_remaining` is the Odds API budget
left; it reads `n/a` for the nflverse and ESPN jobs, which cost nothing.

**Per job**, so one stalled job is not hidden by the others still running:

```bash
ls -la logs/heartbeat/
cat logs/heartbeat/props
```

**The full output of a run:**

```bash
tail -50 logs/snapshot.log
grep -c '^===== ' logs/snapshot.log        # how many runs are in there
grep 'exit=[^0]' logs/*.log               # every failed run
```

Each log is capped at 5 MB and rolls over to `<job>.log.1`, so `logs/` stays
bounded without any cleanup job.

**A one-line summary of every run** also goes to the container log:

```bash
docker compose logs --tail 20 chalk-cron
```

## Running a job by hand

Same wrapper the schedule uses, so it logs and stamps a heartbeat identically:

```bash
docker compose exec chalk-cron /app/docker/run-job.sh snapshot snapshot
docker compose exec chalk-cron /app/docker/run-job.sh ingest-pbp ingest:pbp ingest:players rate
```

To run a script raw, without touching the logs or the heartbeat:

```bash
docker compose exec chalk-cron npm run grade
```

## Updating after a git pull

```bash
cd /volume1/docker/chalk
git pull
docker compose up -d --build
```

`--build` is not optional. The scripts are copied into the image at build time,
so without it the container keeps running the old code. `.env` and `logs/` are
untouched by a rebuild.

To confirm the new code is in — the image carries no `.git`, so check the build
time rather than a commit:

```bash
docker compose images chalk-cron     # CREATED should be just now
docker compose exec chalk-cron ls -l /app/docker/crontab
```

## Troubleshooting

**Nothing has run.** Check the clock inside the container first — a wrong
timezone is the usual cause, and every job would be an hour or five off:

```bash
docker compose exec chalk-cron date
docker compose exec chalk-cron crontab -l
```

**A job fails with a missing key.** Cron starts jobs with almost no environment
of its own, so the entrypoint writes the three keys to `/etc/chalk.env` (mode
600, inside the container only) for jobs to source. If that file is missing or
empty, the container started without `.env`:

```bash
docker compose exec chalk-cron ls -l /etc/chalk.env    # want: -rw------- 3 lines
docker compose down && docker compose up -d
```

**Logs are root-owned and you cannot read them over SMB.** Cron runs as root in
the container, so files in `logs/` land as root:

```bash
sudo chown -R "$(id -u):$(id -g)" logs/
```

**A run was skipped entirely.** Cron does not backfill. If Defiant was asleep or
rebooting at 6:49pm, that capture is simply gone — run it by hand if it was a
closing line you wanted, or let the Actions fallback cover it.

## Actions is a fallback, and right now it double-runs

The GitHub Actions workflows are still enabled and still on their own schedule,
which during CDT is **the same minute** as Defiant's. That is not a fallback, it
is two machines doing the same work:

- `chalk_odds_snapshots` and `chalk_prop_snapshots` gain a duplicate row per
  capture. Nothing breaks — the board reads the newest row per book — but the
  table grows twice as fast.
- **Odds API credits are spent twice.** `snapshot` is one credit a run and
  `snapshot:props` is one per game, so this roughly doubles the monthly bill.
- `grade`, `ingest:*` and `snapshot:context` all upsert, so those are harmless.

Once Defiant has run clean for a week, turn the schedules off and keep the
workflows dispatchable, which is what "fallback" should mean:

```bash
gh workflow disable snapshot.yml
gh workflow disable props.yml
gh workflow disable grade.yml
gh workflow disable ingest_pbp.yml
```

`workflow_dispatch` keeps working while disabled, so the fallback is a single
command away if Defiant is down:

```bash
gh workflow run snapshot.yml
gh workflow enable snapshot.yml     # back to automatic
```
