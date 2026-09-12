-- 006_scoring.sql
-- Persist the scoring ratings that feed the implied total. Until now they were
-- computed in rate.js and thrown away, so a stored rating row could not be used
-- to reconstruct the total that was implied at the time.
--
-- league_avg_total is the same value for every team in a given season/week; it
-- is stored per row so a single row carries everything needed to rebuild an
-- implied total:
--   total = league_avg_total
--         + home.off_scoring_rating + away.off_scoring_rating
--         - home.def_scoring_rating - away.def_scoring_rating

alter table public.chalk_ratings
  add column if not exists off_scoring_rating numeric,  -- points scored above average
  add column if not exists def_scoring_rating numeric,  -- points prevented below average
  add column if not exists league_avg_total   numeric;  -- league average combined points
