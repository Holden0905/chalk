-- 012_context.sql
-- Injury reports and per-game news, both from ESPN's free site API.
--
-- These are the first tables in Chalk that hold text rather than numbers. They
-- exist so a line move can be read against what was known at the time: a
-- quarterback downgraded to doubtful on Saturday night is the sort of thing
-- that explains a two-point move, and without a capture history there is no way
-- to ask that question after the fact.
--
-- Both are captured, not current. Every run writes a new day's rows rather than
-- updating yesterday's, so the history is the point. Re-running on the same day
-- overwrites that day's capture, which is what makes the Saturday and Sunday
-- jobs idempotent if either is retried.

create table if not exists public.chalk_injuries (
  id          bigint generated always as identity primary key,
  captured_at timestamptz not null default now(),

  -- The date of the capture, in UTC, generated so the unique constraint below
  -- cannot be defeated by two runs a few minutes apart.
  captured_on date generated always as ((captured_at at time zone 'utc')::date) stored,

  season  integer,
  week    integer,

  -- The Odds API full name, e.g. "Kansas City Chiefs", which is the team join
  -- key everywhere else in Chalk. ESPN's own displayName is character for
  -- character the same string for all 32 clubs; see espnTeamToOdds in
  -- snapshot_context.js, which routes it through teams.js rather than trusting
  -- that, and the test that pins it.
  team        text not null,
  player_name text not null,
  position    text,

  -- Lower case, as ESPN spells it: out / doubtful / questionable / probable,
  -- plus the roster designations injured reserve and suspension. Players ESPN
  -- lists as "active" are not stored at all -- that is the absence of a
  -- designation, and keeping them would mean 800 rows a capture instead of 230.
  --
  -- Probable has not appeared since the NFL retired the designation in 2016. It
  -- is carried through the ordering anyway, because nothing here should break
  -- if ESPN ever emits it again.
  status text,

  -- ESPN's one-line note, e.g. "Love (ankle) is expected to play Sunday".
  detail text,

  unique (captured_on, team, player_name)
);

create index if not exists chalk_injuries_team_idx on public.chalk_injuries (team, captured_at desc);
create index if not exists chalk_injuries_status_idx on public.chalk_injuries (status);

alter table public.chalk_injuries enable row level security;

create table if not exists public.chalk_game_news (
  id          bigint generated always as identity primary key,
  captured_at timestamptz not null default now(),
  captured_on date generated always as ((captured_at at time zone 'utc')::date) stored,

  season integer,
  week   integer,

  -- Our own Odds API game id, so this joins to chalk_odds_snapshots,
  -- chalk_results and chalk_bets. ESPN has no knowledge of it; the match is
  -- made on both team names and kickoff.
  game_id       text,
  espn_event_id text,

  -- The pregame preview ESPN writes for the game, which is the one piece of
  -- text that is about this game rather than about a team.
  headline text,
  preview  text,

  -- Everything the capture actually used, kept whole so a later pass can mine
  -- it without re-fetching a feed that will have moved on: the preview story as
  -- plain text, the team news items, the venue and weather, ESPN's win
  -- probability and its book lines at capture time.
  raw jsonb,

  unique (captured_on, game_id)
);

create index if not exists chalk_game_news_game_idx on public.chalk_game_news (game_id, captured_at desc);

alter table public.chalk_game_news enable row level security;
