-- 001_snapshots.sql
-- Odds snapshot storage for Chalk. One row per game per bookmaker per capture.

create table if not exists public.chalk_odds_snapshots (
  id             bigint generated always as identity primary key,
  captured_at    timestamptz not null default now(),
  game_id        text,
  commence_time  timestamptz,
  home_team      text,
  away_team      text,
  bookmaker      text,
  spread_home    numeric,
  total          numeric,
  home_ml        integer,
  away_ml        integer
);

create index if not exists chalk_odds_snapshots_game_id_captured_at_idx
  on public.chalk_odds_snapshots (game_id, captured_at);

-- Writes come from the service role (which bypasses RLS). Enabling RLS with no
-- policies keeps the table closed to anon/authenticated clients by default.
alter table public.chalk_odds_snapshots enable row level security;
