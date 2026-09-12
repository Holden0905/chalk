-- 008_props.sql
-- Player prop lines. Anytime-touchdown only for now.
--
-- The Odds API returns these from the per-event odds endpoint, where each
-- outcome carries name = "Yes" and the player in `description`. Anytime TD has
-- no line, so `point` stays null; it exists for over/under style markets if
-- this table is ever extended.

create table if not exists public.chalk_prop_snapshots (
  id            bigint generated always as identity primary key,
  captured_at   timestamptz not null default now(),
  game_id       text,          -- The Odds API event id
  commence_time timestamptz,
  home_team     text,          -- Odds API full team name; see teams.js for the nflverse join
  away_team     text,
  bookmaker     text,
  market        text,
  player_name   text,
  outcome       text,          -- Yes / Over / Under
  price         integer,       -- American odds
  point         numeric        -- null for anytime TD
);

create index if not exists chalk_prop_snapshots_game_market_captured_idx
  on public.chalk_prop_snapshots (game_id, market, captured_at);

alter table public.chalk_prop_snapshots enable row level security;
