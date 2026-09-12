-- 004_ratings.sql
-- SP+-style team ratings, computed as of a given week using only games played
-- before that week. One row per team per week.

create table if not exists public.chalk_ratings (
  id       bigint generated always as identity primary key,
  season   integer not null,
  week     integer not null,  -- the week the rating is AS OF; inputs are weeks < this
  team     text    not null,  -- nflverse abbreviation

  -- All four are in points of expected margin against an average team on a
  -- neutral field. offense + defense + st equals team_rating.
  offense_rating numeric,
  defense_rating numeric,     -- inverted, so higher is a better defense
  st_rating      numeric,
  team_rating    numeric,

  games_used integer,         -- current-season games behind the rating; 0 means prior season only

  constraint chalk_ratings_season_week_team_key unique (season, week, team)
);

alter table public.chalk_ratings enable row level security;
