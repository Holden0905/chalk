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
| `chalk_team_weeks` | One row per team per game week, from nflverse play-by-play. Offense and defense efficiency splits, field position, points per trip inside the 40, points scored and allowed, and net special teams EPA. Foundation for an SP+-style rating. | `migrations/003_team_weeks.sql` |
| `chalk_player_weeks` | One row per player per game, for anyone with a rush, target or pass attempt. Rushing, receiving and passing lines plus red zone and goal line usage. Position comes from the season roster file. | `migrations/007_players.sql` |
| `chalk_defense_weeks` | One row per defense per game: touchdowns and yards allowed, red zone trips and conversions allowed, and targets allowed split by receiver position. | `migrations/007_players.sql` |
| `chalk_prop_snapshots` | Anytime-touchdown prices, one row per bookmaker per player per capture. | `migrations/008_props.sql` |
| `chalk_bets` | The bet log: what was taken, at what number and price, plus the closing line, CLV, result and profit once graded. | `migrations/009_bets.sql` |
| `chalk_ratings` | One row per team per week: offense, defense, special teams and total rating in points of expected margin, plus the scoring ratings and league average total that an implied total is built from (apply `total_scale` to the combined adjustment when reconstructing one). Computed **as of** that week from games played before it. | `migrations/004_ratings.sql`, `migrations/006_scoring.sql` |
| `chalk_games` | One row per **regular season** game since 2022, from the nflverse games file. Schedule, rest days, venue, the closing spread and total, and the final score, plus generated `total_points`, `home_margin`, `home_covered`, `went_over` and `total_diff`. Feeds `/league`. | `migrations/011_games.sql` |

`chalk_results.game_id` is unique and matches `chalk_odds_snapshots.game_id`,
so a result joins straight to that game's full line history.

`home_covered` and `went_over` are **null on an exact push**, which is
different from a game not being graded at all — an ungraded game has no row.
`chalk_games` follows the same rule, except that a scheduled game does have a
row, with a null score, until it is played.

**The two spread conventions.** `chalk_results.closing_spread_home` is the home
team's handicap the way a bettor writes it, so a home favorite is **negative**.
`chalk_games.spread_line` is copied straight from nflverse, where a home
favorite is **positive**. The second sign points the same way as `home_margin`,
which is what makes "priced at +1.5, played at +2.1" a subtraction rather than a
puzzle; `web/src/lib/league.mjs` flips it once, in `homeLine()`, for anything
displayed as a line. Nothing else should flip it again.

`chalk_games` overlaps `chalk_results` on purpose. `chalk_results` only holds
games Chalk graded from its own odds snapshots, which begins the day the
snapshotter did; `chalk_games` reaches back four seasons, so a rate has
something to be measured against.

### Counting rules in the player tables

Three nflverse conventions differ from how the stats are normally counted, all
verified against the 2025 file:

- **Sacks carry `pass_attempt = 1`.** Official pass attempts do not count them,
  so `pass_att` excludes sacks. Leaving them in would have added ~1,350 phantom
  attempts to a season.
- **Two-point conversions carry `rush_attempt` and `pass_attempt`** but never
  `rush_touchdown` or `pass_touchdown`. They are excluded everywhere.
- **Extra points sit at `yardline_100 = 15`.** Red zone is therefore measured
  from scrimmage plays only; counting the PAT would mark nearly every touchdown
  drive as a red zone trip, including 60-yard ones.

Touchdown attribution is clean: every `rush_touchdown` has `td_player_id`
equal to the rusher and every `pass_touchdown` equals the receiver, and
defensive or return touchdowns set neither flag, so "allowed" counts only
offensive scores.

`rec_yds` league-wide runs about 200 yards short of `pass_yds_allowed` per
season. That is entirely laterals — 18 plays in 2025 — where nflverse credits
the lateral recipient under a separate column that these tables do not capture.
`pass_yds` and `pass_yds_allowed` reconcile exactly.

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
| `.github/workflows/props.yml` | `0 14 * * 6` Saturday | `npm run snapshot:props` — anytime-TD prices for every game in the next 7 days. The events endpoint is free, so this costs one API credit per game. |
| `.github/workflows/ingest_pbp.yml` | `0 13 * * 2` Tuesday | `npm run ingest:games`, then `npm run ingest:pbp`, then `npm run ingest:players`, then `npm run rate` — refreshes the games table, rebuilds the current season's team weeks, player and defense weeks from nflverse, then rates every team as of the upcoming week. Runs an hour after grade. Dispatch takes an optional `season` input for backfills. |

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
npm run ingest:games         # refresh every regular season game 2022-now (no Odds API cost)
npm run ingest:games -- 2025 # or just one season
npm run ingest:pbp -- 2025      # rebuild team weeks for a season (no Odds API cost)
npm run ingest:players -- 2025  # rebuild player and defense weeks for a season
npm run rate -- 2025 10      # ratings as of week 10; bare `npm run rate` does current season, next week
npm run backtest -- 2024 2025   # backtest spreads and totals; any number of seasons, pooled
npm run residuals            # closing-line cover/over rates by bucket, 2024-2025
npm run snapshot:props       # anytime-TD prices for the next 7 days
npm run finder -- 2026 1     # TD board for a week: usage, matchup, best price
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

`rate.js` also produces an **implied total**: the league average combined
points, plus both offenses' scoring ratings, minus both defenses'. Scoring
ratings blend z-scored points for/against with the efficiency composites
(`scoring_blend`), carried in real point units.

### Backtest

`npm run backtest -- 2024 2025` takes any number of seasons and pools them.
`rating_points_per_sd` is **3.8532**, fitted so the spread calibration slope is
1.000 on 2025. 2024 is therefore out-of-sample for that fit, and out-of-sample
for the totals model entirely, which was never fitted on anything.

| | games | our MAE | vegas MAE | gap |
| --- | --- | --- | --- | --- |
| Spread 2024 | 256 | 10.635 | 9.648 | +0.987 |
| Spread 2025 | 256 | 10.627 | 9.959 | +0.668 |
| Total 2024 | 256 | 10.290 | 9.723 | +0.568 |
| Total 2025 | 256 | 10.635 | 10.262 | +0.374 |

**Spreads are a dead end.** ATS is below break-even at nearly every threshold
in all three seasons, and gets worse as the disagreement grows.

**The totals lead did not survive.** It looked real on 2024-2025 at
`total_scale` 1.0: O/U rising with disagreement to 58.9% at 4+ points. Two
checks killed it.

*Calibration.* Implied totals were swinging about twice as wide as they should
(slope 0.512). Fitting `total_scale` to 0.4730 puts the slope at 1.000 and cuts
the MAE gap from +0.471 to +0.142 — but the O/U edge goes with it:

| total_scale | slope | MAE gap | O/U at 3+ | 4+ | 5+ | 6+ |
| --- | --- | --- | --- | --- | --- | --- |
| 1.00 | 0.512 | +0.471 | 56.2% | 58.9% | 60.3% | 60.0% |
| 0.75 | 0.670 | +0.228 | 58.3% | 59.9% | 56.8% | 58.7% |
| 0.473 | 1.000 | +0.142 | 55.7% | 52.1% | 53.7% | 48.4% |

The threshold filter was working *because* the numbers were over-spread, not
despite it. A fixed point threshold also selects far fewer games as the scale
shrinks (94 bets at 4+ versus 210), so the comparison is not like-for-like —
but the practical question, whether betting a 4-point disagreement wins, is
answered no once the number is honest.

*A third season.* 2023 is out-of-sample for the 0.4730 fit and shows nothing:
46.5 / 48.7 / 52.8 / 56.3 / 40.9 / 35.7% at 1-6 points. Across all three
seasons the O/U record is 51.0 / 54.3 / 55.0 / 53.2 / 50.0 / 44.4% — no edge
and no monotonic shape.

`total_scale` is also unstable season to season: 0.4730 fits 2024-2025, 0.2334
fits 2023, 0.4101 fits all three. A parameter that moves by a factor of two
between samples is not measuring something durable.

Neither market is a usable betting model, and the totals lead is closed.

### Residual buckets

`npm run residuals` prints closing-line cover and over rates across 2024-2025
(544 games) sliced by divisional, rest, blowout hangover, line size, total
size, early/late season, and cold-weather outdoor games. Descriptive only.

## TD finder

`npm run finder -- <season> <week>` prints a per-game board of skill players
averaging at least 6 touches (rushes + targets) over their last four games,
with season and last-4 touchdowns, goal-line and red-zone usage per game, the
opponent defence's touchdown rates and league rank, and the best available
anytime-TD price with its book. Sorted by last-4 goal-line touches per game.
It deliberately produces no composite score and no pick.

Rushing-type players (QB) are shown against the opponent's rush TD rate,
receiving-type (WR, TE) against the pass TD rate, and RBs against both.

Two things it handles that are easy to get wrong in week 1:

- **Rosters come from the current season's roster file, not last season's game
  log.** In 2026 week 1, 147 players had changed team since their last game;
  using the game log would have listed them for the wrong side.
- **Name joins between nflverse and the props feed.** nflverse writes
  `D.Adams`, the feed writes `Davante Adams`. Both collapse to one key, which
  also has to survive `Amon-Ra St. Brown`, `Michael Pittman Jr.`, initial-style
  given names like `C.J. Stroud` (which looks exactly like nflverse's own
  abbreviation format), and nflverse's widened initials such as `Ty.Johnson`.
  Unmatched names are reported, with team D/ST entries excluded.

## Bet log and CLV

```
node bet.js add --game "ATL @ PIT" --market total --side Over --line 41.5 \
                --price -110 --stake 25 --book draftkings --note "text"
node bet.js list
```

`--game` takes "AWAY @ HOME" with abbreviations or full names and resolves it
against upcoming games in `chalk_odds_snapshots`, asking before guessing when
more than one game matches. `--game-id` skips resolution.

`npm run grade` settles bets whenever their game has a result, filling the
closing line, CLV, result and profit, then prints a per-season summary with
record, profit, ROI, average CLV and the share of bets that beat the close.

CLV is measured in points of line for spreads and totals, and in percentage
points of implied probability for moneyline and anytime touchdown, where there
is no line to move. It is positive whenever the bet beat the close. The closing
quote comes from the bet's own book when that book posted a number in the last
pre-kickoff capture, falling back to draftkings, then fanduel, then any book.

Two limits worth knowing:

- **`closing_price` is null for spreads and totals.** `chalk_odds_snapshots`
  stores the line but not the juice, so only the line moves are measurable.
  CLV for those markets is in points, which is the usual measure anyway.
- **Anytime touchdown grades from rushing and receiving scores only**, since
  those are the only touchdowns `chalk_player_weeks` carries. A return or
  defensive touchdown would not settle a ticket most books would pay.

## Web app

`web/` is a Next.js front end for all of this, deployed to Vercel. Mobile
first, installable on a phone, gated behind a single password.

```bash
cd web
npm install
cp ../.env .env.local
echo 'CHALK_PASSWORD=pick-something' >> .env.local
npm run dev
```

Phase 1 ships the app shell, the Board and the About page. Teams, Stats, TDs
and Bets are in the nav but stubbed. See `web/README.md` for the four
environment variables and the Vercel setup, the important part being that the
project Root Directory must be `web`.

`/league` is the league-wide view, built entirely from `chalk_games`: scoring,
the market, sixteen situational splits and a per-week chart, as a comparison
table with one column per selected season and an All column that is always
there. Every figure carries the number of games it came off, because a cover
rate without its sample is an assertion rather than a measurement. There is no
rating, no projection and no Chalk number anywhere on that page — it is what the
league did, not what Chalk thinks of it. The arithmetic lives in
`web/src/lib/league.mjs`, which does no IO and is covered by
`test/league.test.mjs`.

Data is read server side only, with the service key, because every `chalk_*`
table has RLS on with no policies. Nothing with a key in it is ever sent to the
browser.

## Backlog

- **The totals scale is over-spread.** Spread calibration is fitted at 1.000
  but totals come out at 0.557, so implied totals swing roughly twice as far as
  they should. A separate scale for totals is the obvious next step.
- **`rating_points_per_sd` is fitted on 2025 only.** One season, in-sample for
  the fit. Re-fit across 2024 and 2025 before trusting it.
- **Both markets are closed as leads.** Three seasons, calibrated and
  uncalibrated, show no durable edge in either spreads or totals. Any next
  attempt should change the inputs rather than retune this rating.
- **The rating's inputs may simply be too coarse.** Everything is season-to-date
  team aggregates with no personnel, injury, weather or in-game context. The
  residual buckets are the only place structure has shown up.
- **Confirm the `LA` / `SEA` / `SF` team name mappings** in `teams.js` against a
  real `chalk_odds_snapshots` row once those teams are captured.
- **Fall back to ESPN's scoreboard API in `grade.js` for games older than three
  days.** The Odds API scores feed is capped at `daysFrom=3` and cannot reach
  further back, so any game missed by a skipped or failed grade run is
  currently ungradable forever. An ESPN scoreboard lookup keyed by date would
  let those be backfilled.
