-- 007_players.sql
-- Player-level and defense-level weekly boxes from nflverse play-by-play.
--
-- Counting notes, all verified against the 2025 file:
--   * pass_att excludes sacks. nflverse sets pass_attempt = 1 on sacks, but
--     official pass attempts do not count them.
--   * Two-point conversions are excluded everywhere: they carry rush_attempt
--     and pass_attempt but never rush_touchdown or pass_touchdown.
--   * Red zone is measured from scrimmage plays only. Extra points sit at
--     yardline_100 = 15, so counting them would mark almost every touchdown
--     drive as a red zone trip.

create table if not exists public.chalk_player_weeks (
  id          bigint generated always as identity primary key,
  season      integer not null,
  week        integer not null,
  player_id   text    not null,  -- nflverse GSIS id
  player_name text,
  team        text,
  position    text,              -- from the season roster file; null if unavailable
  opponent    text,

  rush_att integer,
  rush_yds integer,
  rush_td  integer,

  targets    integer,
  receptions integer,
  rec_yds    integer,
  rec_td     integer,

  rz_rush_att integer,  -- rushes from yardline_100 <= 20
  rz_targets  integer,  -- targets from yardline_100 <= 20
  gl_touches  integer,  -- rushes or targets from yardline_100 <= 5

  pass_att   integer,   -- sacks excluded
  pass_yds   integer,
  pass_td    integer,
  int_thrown integer,

  constraint chalk_player_weeks_season_week_player_key unique (season, week, player_id)
);

create table if not exists public.chalk_defense_weeks (
  id       bigint generated always as identity primary key,
  season   integer not null,
  week     integer not null,
  team     text    not null,
  opponent text,

  rush_td_allowed integer,
  pass_td_allowed integer,

  rz_trips_allowed integer,  -- opponent drives reaching yardline_100 <= 20
  rz_td_allowed    integer,  -- those trips that produced an offensive touchdown

  rush_yds_allowed integer,
  pass_yds_allowed integer,  -- excludes sack losses, as official passing yards do

  targets_allowed_rb integer,  -- null when roster positions were unavailable
  targets_allowed_wr integer,
  targets_allowed_te integer,

  constraint chalk_defense_weeks_season_week_team_key unique (season, week, team)
);

alter table public.chalk_player_weeks  enable row level security;
alter table public.chalk_defense_weeks enable row level security;
