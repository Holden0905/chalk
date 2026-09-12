-- 003_team_weeks.sql
-- Per-team, per-week box of efficiency stats derived from nflverse play-by-play.
-- Two rows per game, one for each team, computed from that game's plays only.
-- Foundation for an SP+-style rating.

create table if not exists public.chalk_team_weeks (
  id       bigint generated always as identity primary key,
  season   integer not null,
  week     integer not null,
  team     text    not null,  -- nflverse abbreviation; see teams.js for the Odds API mapping
  opponent text,
  is_home  boolean,

  -- Offense: the team with the ball.
  off_plays                     integer,
  off_success_rate              numeric,
  off_epa_per_play              numeric,
  off_pass_success_rate         numeric,
  off_pass_epa_per_play         numeric,
  off_rush_success_rate         numeric,
  off_rush_epa_per_play         numeric,
  off_points_per_trip_inside_40 numeric,
  off_avg_start_yardline        numeric,  -- yardline_100 at drive start; HIGHER means worse field position
  off_turnovers                 integer,  -- giveaways

  -- Defense: the same stats allowed to the opponent.
  def_plays                     integer,
  def_success_rate              numeric,
  def_epa_per_play              numeric,
  def_pass_success_rate         numeric,
  def_pass_epa_per_play         numeric,
  def_rush_success_rate         numeric,
  def_rush_epa_per_play         numeric,
  def_points_per_trip_inside_40 numeric,
  def_avg_start_yardline        numeric,
  def_turnovers                 integer,  -- takeaways

  -- Net EPA across field goal, punt, kickoff and return plays: EPA earned as
  -- the kicking/possessing team minus EPA conceded as the returning team.
  st_epa numeric,

  constraint chalk_team_weeks_season_week_team_key unique (season, week, team)
);

-- Same posture as the other chalk tables: service-role writes, no client access.
alter table public.chalk_team_weeks enable row level security;
