# Chalk

NFL odds and results tracker, for studying betting edges. It captures
bookmaker lines on a schedule, then grades finished games against the closing
number.

## Tables

All live in the Supabase project **Bump**. Both are written by the service
role, and both have RLS enabled with no policies, so anon and authenticated
clients have no access.

| Table | Grain | Migration |
| --- | --- | --- |
| `chalk_odds_snapshots` | One row per game per bookmaker per capture. Spread, total and both moneylines, stamped with `captured_at`. | `migrations/001_snapshots.sql` |
| `chalk_results` | One row per graded game, keyed by `game_id`. Final score, the closing line used, and whether the home side covered / the game went over. | `migrations/002_results.sql` |
| `chalk_team_weeks` | One row per team per game week, from nflverse play-by-play. Offense and defense efficiency splits, field position, points per trip inside the 40, and net special teams EPA. Foundation for an SP+-style rating. | `migrations/003_team_weeks.sql` |
| `chalk_ratings` | One row per team per week: offense, defense, special teams and total rating, in points of expected margin. Computed **as of** that week from games played before it. | `migrations/004_ratings.sql` |

`chalk_results.game_id` is unique and matches `chalk_odds_snapshots.game_id`,
so a result joins straight to that game's full line history.

`home_covered` and `went_over` are **null on an exact push**, which is
different from a game not being graded at all — an ungraded game has no row.

`chalk_team_weeks.off_avg_start_yardline` is `yardline_100` at drive start, so
**higher is worse** field position: 75 means the drive began on the team's own
25. `off_points_per_trip_inside_40` is null when a team never reached the
opponent's 40 in that game, which is different from zero points.

The Bump project also contains `profiles` and `daily_picks`, which belong to a
separate MLB app. Chalk does not read or write them.

### Joining odds to team stats

`chalk_team_weeks.team` uses nflverse abbreviations (`KC`, `LA`, `WAS`);
`chalk_odds_snapshots` uses The Odds API's full names (`Kansas City Chiefs`).
`teams.js` maps between them in both directions and resolves relocation
aliases (`STL`/`LAR` to `LA`, `SD` to `LAC`, `OAK` to `LV`).

Three mappings are **unverified** — `LA`, `SEA` and `SF`. No game involving the
Rams, Seahawks or 49ers had been captured in `chalk_odds_snapshots` when the
mapping was written, so those three names are the Odds API's documented
spelling rather than a string observed in our own data. `teams.js` exports them
as `UNVERIFIED`; confirm them once those teams appear in a snapshot.

## Workflows

| Workflow | Schedule (UTC) | What it does |
| --- | --- | --- |
| `.github/workflows/snapshot.yml` | `0 14 * * *` daily<br>`0 0 * * 5` Thu night ET (TNF)<br>`30 16 * * 0` Sun early slate<br>`0 20 * * 0` Sun late afternoon<br>`0 0 * * 1` Sun night ET (SNF)<br>`0 0 * * 2` Mon night ET (MNF) | `npm run snapshot` — captures current lines for every upcoming game. |
| `.github/workflows/grade.yml` | `0 12 * * 2` Tuesday<br>`0 12 * * 5` Friday | `npm run grade` — grades completed games against their closing line. |
| `.github/workflows/ingest_pbp.yml` | `0 13 * * 2` Tuesday | `npm run ingest:pbp` then `npm run rate` — rebuilds the current season's team weeks from nflverse, then rates every team as of the upcoming week. Runs an hour after grade. Dispatch takes an optional `season` input for backfills. |

Both run on `ubuntu-latest` with Node 22, both support `workflow_dispatch`,
and both read `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and `ODDS_API_KEY` from
repository secrets (Settings → Secrets and variables → Actions).

Two things to know about the schedules:

- **Cron is fixed to UTC, so the ET times drift an hour when DST ends on Sun
  Nov 1 2026.** Every capture lands an hour earlier in ET from that date. See
  the comment block at the top of `snapshot.yml`.
- **The grade schedule is constrained by the scores feed.** The Odds API
  scores endpoint only reaches back `daysFrom=3`, so Tuesday and Friday have
  to cover the whole week between them. If a run is skipped, games in the gap
  become permanently ungradable. GitHub also auto-disables scheduled workflows
  after 60 days of repo inactivity, which is the likeliest way for that to
  happen mid-season.

## Local use

Requires a `.env` with `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and
`ODDS_API_KEY`.

```
npm install
npm run snapshot   # capture current lines (costs 1 Odds API request)
npm run grade      # grade finished games (costs 1 request, or 0 if nothing is gradable)
npm run ingest:pbp -- 2025   # rebuild team weeks for a season (no Odds API cost)
npm run rate -- 2025 10      # ratings as of week 10; bare `npm run rate` does current season, next week
npm run backtest -- 2025     # backtest the rating against closing lines
npm test           # pure-logic tests; no credentials or network needed
```

## The rating

`weights.json` holds everything tunable — per-stat weights for offense and
defense, the special teams weight, the prior-season blend curve, opponent
adjustment iterations, home field, and the points scale. Change it without
touching code.

`rate.js` z-scores each stat across the league, weights them into offense and
defense composites (defense inverted so higher is better), adjusts iteratively
for the quality of opponents faced, then centres and scales so one rating point
is one point of expected margin against an average team on a neutral field.

**Ratings for week N use only games from weeks before N.** That is enforced by
the filter in `computeRatings`, and tested by feeding in extreme future weeks
and asserting the ratings do not move. `npm run backtest` prints a per-week
lookahead audit showing the latest week used.

### Baseline backtest, 2025 weeks 2-18 (256 games)

| | MAE vs actual margin |
| --- | --- |
| Our implied spread | 10.718 |
| Vegas closing line | 9.959 |
| Gap | **+0.759 worse** |

ATS, betting the side our number favours: 49.5% at 1+ point of disagreement,
50.0% at 2+, 44.2% at 3+, 38.0% at 4+ — all below the 52.38% break-even, and
**getting worse as disagreement grows**, which is the opposite of what an edge
looks like. The calibration slope is 0.771 (1.00 is perfectly scaled), meaning
the numbers are spread too wide: implied SD 6.99 against Vegas 6.32.

This is an unturned baseline, recorded as a starting point, not a usable
betting model.

## Backlog

- **Totals are not modelled.** The rating is margin-only: every input is a
  z-scored efficiency rate and `chalk_team_weeks` stores no points scored or
  allowed, so there is nothing to anchor an expected total to. Adding points
  for/against to the team-week table is the prerequisite.
- **The rating scale is uncalibrated.** The backtest slope of 0.771 implies
  `rating_points_per_sd` nearer 3.9 than the current 5.0. Left alone
  deliberately so the baseline is untuned.
- **Confirm the `LA` / `SEA` / `SF` team name mappings** in `teams.js` against a
  real `chalk_odds_snapshots` row once those teams are captured.
- **Fall back to ESPN's scoreboard API in `grade.js` for games older than three
  days.** The Odds API scores feed is capped at `daysFrom=3` and cannot reach
  further back, so any game missed by a skipped or failed grade run is
  currently ungradable forever. An ESPN scoreboard lookup keyed by date would
  let those be backfilled.
