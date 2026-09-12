-- 009_bets.sql
-- Bet log with closing line value.
--
-- `line` and `price` are always from the bettor's side: a bet on the home team
-- at -3 stores -3, a bet on the away team at +3 stores +3. clv_points is
-- positive when the bet beat the close.
--
-- For spreads and totals CLV is in points of line. For moneyline and anytime
-- touchdown there is no line to move, so CLV is the change in implied
-- probability, also expressed in points (percentage points).

create table if not exists public.chalk_bets (
  id        bigint generated always as identity primary key,
  placed_at timestamptz not null default now(),

  game_id       text,
  commence_time timestamptz,
  market        text,     -- spread / total / moneyline / anytime_td
  side          text,     -- team name, Over/Under, or player name
  line          numeric,  -- null for moneyline and anytime_td
  price         integer,  -- American odds taken
  stake         numeric,
  book          text,
  note          text,

  closing_line  numeric,
  closing_price integer,
  clv_points    numeric,

  result    text,      -- win / loss / push
  profit    numeric,   -- net return, stake excluded; negative on a loss
  graded_at timestamptz
);

create index if not exists chalk_bets_game_idx on public.chalk_bets (game_id);
create index if not exists chalk_bets_ungraded_idx on public.chalk_bets (graded_at) where graded_at is null;

alter table public.chalk_bets enable row level security;
