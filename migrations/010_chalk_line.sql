-- 010_chalk_line.sql
-- What Chalk's own number was for this game at the moment the bet was placed.
--
-- Stored rather than recomputed, because the rating moves every week and the
-- question worth answering later is "did I agree with my own number when I
-- pulled the trigger", not "do I agree with it now".
--
-- Spread bets store the number from the bettor's side, the same convention as
-- `line`. Totals store the implied total. Moneyline and anytime touchdown have
-- no line for Chalk to have an opinion about, so they stay null.

alter table public.chalk_bets
  add column if not exists chalk_line numeric;
