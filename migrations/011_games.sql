-- 011_games.sql
-- One row per regular season game, from the nflverse games/schedules file.
-- Seasons 2022 onward, weeks 1 to 18. Playoffs are never ingested.
--
-- This is the league-wide table behind /league: schedule, rest, venue, the
-- closing spread and total, and the final score. It overlaps chalk_results
-- deliberately -- chalk_results only holds games Chalk has graded from its own
-- odds snapshots, which starts the day the snapshotter did. This one reaches
-- back four seasons so a rate has something to be compared against.
--
-- SPREAD SIGN. spread_line is stored exactly as nflverse publishes it, which is
-- the OPPOSITE of the convention chalk_results.closing_spread_home uses:
--
--   chalk_games.spread_line             positive means the HOME team is favored
--   chalk_results.closing_spread_home   negative means the HOME team is favored
--
-- Keeping nflverse's sign here means spread_line and home_margin point the same
-- way, so "priced at +1.5, played at +2.1" is a straight subtraction. The web
-- layer flips it once, in leagueData.ts, for anything shown as a bettor's line.

create table if not exists public.chalk_games (
  id        bigint generated always as identity primary key,
  game_id   text    not null unique,  -- nflverse key, e.g. 2025_07_KC_LV
  season    integer not null,
  week      integer not null,         -- 1 to 18; regular season only

  weekday   text,                     -- Sunday, Thursday, Monday, ...
  kickoff   timestamptz,              -- gameday + gametime, which nflverse publishes in Eastern

  home_team text,                     -- nflverse abbreviation; see teams.js for the Odds API mapping
  away_team text,
  home_score integer,                 -- null until the game is played
  away_score integer,

  spread_line numeric,                -- POSITIVE means the home team is favored (see above)
  total_line  numeric,

  home_rest integer,                  -- days since that team's previous game
  away_rest integer,
  div_game  boolean,
  roof      text,                     -- outdoors / dome / closed / open
  surface   text,                     -- grass / fieldturf / matrixturf / sportturf / astroturf / a_turf
  overtime  boolean,

  -- Derived, and generated rather than written by the ingest so they cannot
  -- drift from the score and the lines they are built out of.
  total_points integer generated always as (home_score + away_score) stored,
  home_margin  integer generated always as (home_score - away_score) stored,

  -- Null on a push, the same rule chalk_results uses, so a push is never
  -- counted as a win or a loss for either side.
  home_covered boolean generated always as (
    case
      when home_score is null or away_score is null or spread_line is null then null
      when (home_score - away_score) = spread_line then null
      else (home_score - away_score) > spread_line
    end
  ) stored,

  went_over boolean generated always as (
    case
      when home_score is null or away_score is null or total_line is null then null
      when (home_score + away_score) = total_line then null
      else (home_score + away_score) > total_line
    end
  ) stored,

  -- Actual minus closing. Positive means the game outran its number.
  total_diff numeric generated always as ((home_score + away_score) - total_line) stored,

  ingested_at timestamptz not null default now()
);

create index if not exists chalk_games_season_week_idx on public.chalk_games (season, week);
create index if not exists chalk_games_kickoff_idx on public.chalk_games (kickoff);

alter table public.chalk_games enable row level security;
