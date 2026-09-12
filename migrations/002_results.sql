-- 002_results.sql
-- Graded finals for Chalk. One row per game, keyed by the same game_id that
-- chalk_odds_snapshots uses, so a result joins straight to its line history.

create table if not exists public.chalk_results (
  id                  bigint generated always as identity primary key,
  game_id             text not null unique,
  commence_time       timestamptz,
  home_team           text,
  away_team           text,
  home_score          integer,
  away_score          integer,
  closing_spread_home numeric,
  closing_total       numeric,
  closing_book        text,
  -- null means the game pushed exactly against the closing number, which is
  -- distinct from "not yet graded" (no row at all).
  home_covered        boolean,
  went_over           boolean,
  graded_at           timestamptz not null default now()
);

-- Same posture as chalk_odds_snapshots: writes come from the service role,
-- which bypasses RLS, so no policies are needed to keep clients out.
alter table public.chalk_results enable row level security;
