# Runbook: Chalk captures on Defiant

Defiant (UGOS NAS, Docker) is where Chalk's scheduled captures run. One
container, `chalk-cron`: the repo-root ingest scripts plus a cron daemon, on
Central time. The GitHub Actions workflows are still in the repo as a fallback —
see **Actions is a fallback, and right now it double-runs** at the bottom, which
is the one thing to deal with on day one.

Nothing here touches `web/`. The site is on Vercel and is unaffected.

## Every compose command takes `-p chalk`

```bash
sudo docker compose -p chalk <whatever>
```

Without `-p`, compose derives the project name from the directory it is run in.
Run one command from the wrong directory and it will not find the running
container — worse, `up` will happily build a *second* project alongside the
first, and you will have two chalk-cron containers capturing the same lines
twice. Every command below carries the flag; keep it.

Compose on Defiant needs `sudo` too, so the full prefix is
`sudo docker compose -p chalk`.

The flag is only for compose, which thinks in projects. Anything that reaches
into the container that is already running goes through `sudo docker exec
chalk-cron ...`, which addresses it by name and needs no `-p`. So: `up`, `down`,
`ps`, `logs`, `images` take the flag; `exec` does not.

(If you would rather not type it, adding `name: chalk` at the top of
`docker-compose.yml` pins the project name and makes `-p` unnecessary. Left out
here deliberately: the container is already running under a project name, and
changing it out from under a live container orphans it.)

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

Check the service key survived the paste. It is long, and a terminal or a
clipboard that wraps or truncates it produces a key that looks right and fails
on every call:

```bash
sudo grep SUPABASE_SERVICE_KEY .env | wc -c
# 241
```

241 is the whole line: the `SUPABASE_SERVICE_KEY=` prefix, the key, and the
newline. Anything else means it was mangled — usually a line break pasted into
the middle of it, or a missing final newline. `wc -c` gives a count and nothing
else, so this is safe to run and to paste into a chat; never `cat` the file.

`.env` is in `.gitignore` and in `.dockerignore`, so it is never committed and
never baked into the image. Compose reads it at `up` time and passes the values
in as environment.

Then:

```bash
sudo docker compose -p chalk up -d --build
```

First build pulls `node:22-bookworm-slim` and runs `npm ci`; a minute or two.

Confirm it came up with all three keys:

```bash
sudo docker compose -p chalk logs chalk-cron
```

You want the `chalk-cron: up at ...` line followed by 13 scheduled jobs. A
`WARNING <NAME> is not set` line means `.env` is missing or misspelt — only the
variable name is ever printed, never the value.

## Changing .env

**`restart` does not reload `env_file`.** Compose reads `.env` when it *creates*
a container and bakes the values into it; restarting replays the same container
with the same environment, so a corrected key appears to have no effect and the
job keeps failing exactly as before. The container has to be recreated:

```bash
cd /volume1/docker/chalk
sudo docker compose -p chalk up -d --force-recreate
```

`--force-recreate` is the part that matters — without it compose sees a config
it thinks is unchanged and leaves the container alone. No rebuild is needed,
because nothing in the image changed; `logs/` is a bind mount and survives.

Then confirm the container came up with all three keys:

```bash
sudo docker compose -p chalk logs --tail 20 chalk-cron
sudo docker exec chalk-cron ls -l /etc/chalk.env
```

Want the `chalk-cron: up at ...` line with no `WARNING ... is not set` under it,
and a three-line `-rw-------` file. Then run a job by hand to prove the key
works end to end:

```bash
sudo docker exec chalk-cron /app/docker/run-job.sh context
```

`context` is the one to test with: it hits Supabase and ESPN and spends no Odds
API credits.

## Checking on it

**Is it alive?** The container is healthy when something has run in the last 26
hours, which the daily 9:17am snapshot guarantees:

```bash
sudo docker compose -p chalk ps
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
sudo docker compose -p chalk logs --tail 20 chalk-cron
```

## Running a job by hand

Same wrapper the schedule uses, and the same command — a cron line is a job
name and nothing else, so what you type by hand is what cron runs:

```bash
sudo docker exec chalk-cron /app/docker/run-job.sh snapshot
sudo docker exec chalk-cron /app/docker/run-job.sh ingest-pbp
```

The jobs are `snapshot`, `props`, `context`, `grade`, `ingest-games` and
`ingest-pbp`. Which npm scripts each one runs is the table at the top of
`docker/run-job.sh`. To see what a job would do without doing it:

```bash
sudo docker exec -e CHALK_DRY_RUN=1 chalk-cron /app/docker/run-job.sh ingest-pbp
# ingest:pbp ingest:players rate
```

An unknown job name exits 2 rather than pretending to have run, and says so in
the log and the heartbeat.

To run a script raw, without touching the logs or the heartbeat:

```bash
sudo docker exec chalk-cron npm run grade
```

## Updating after a git pull

```bash
cd /volume1/docker/chalk
git pull
sudo docker compose -p chalk up -d --build
```

`--build` is not optional. The scripts are copied into the image at build time,
so without it the container keeps running the old code. `.env` and `logs/` are
untouched by a rebuild.

To confirm the new code is in — the image carries no `.git`, so check the build
time rather than a commit:

```bash
sudo docker compose -p chalk images chalk-cron     # CREATED should be just now
sudo docker exec chalk-cron ls -l /app/docker/crontab
```

## Troubleshooting

**Nothing has run.** Check the clock inside the container first — a wrong
timezone is the usual cause, and every job would be an hour or five off:

```bash
sudo docker exec chalk-cron date
sudo docker exec chalk-cron crontab -l
```

**A job fails with a missing key.** Cron starts jobs with almost no environment
of its own, so the entrypoint writes the three keys to `/etc/chalk.env` (mode
600, inside the container only) for jobs to source. If that file is short or
missing, the container started without some of `.env`:

```bash
sudo docker exec chalk-cron ls -l /etc/chalk.env    # want: -rw------- 3 lines
sudo grep -c . .env                                                  # want: 3
sudo grep SUPABASE_SERVICE_KEY .env | wc -c                          # want: 241
```

Fix `.env`, then recreate the container — see **Changing .env** above. A
`restart` will not do it: the environment is fixed when the container is
created, so the old values come straight back.

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
