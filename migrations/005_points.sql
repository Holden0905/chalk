-- 005_points.sql
-- Points scored and allowed per team per game. The efficiency stats in
-- chalk_team_weeks are all rates, which is enough to rate margin but leaves
-- nothing to anchor an expected points total to. These two columns are that
-- anchor.

alter table public.chalk_team_weeks
  add column if not exists off_points integer,  -- points this team scored
  add column if not exists def_points integer;  -- points this team allowed
