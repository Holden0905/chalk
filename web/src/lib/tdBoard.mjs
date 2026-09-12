/**
 * TD board logic, shared by the finder CLI at the repo root and the /tds page.
 * Pure: it takes rows and returns a board, and does no IO of its own, so the
 * CLI and the web app cannot drift apart in how a board is built.
 */

export const MARKET = "player_anytime_td";
export const MIN_TOUCHES = 6; // per game, averaged over the last four
export const LAST_N = 4;
export const SKILL = new Set(["QB", "RB", "WR", "TE"]);

/** Which defensive touchdown rate is the relevant one for a player. */
export const MATCHUP = { RB: "BOTH", QB: "RUSH", WR: "PASS", TE: "PASS" };

/** Team defence entries in the props feed are not players. */
export const TEAM_DEFENCE = /\b(D\/ST|Defense|Defence)\b/i;

const n = (v) => (v == null || v === "" ? 0 : Number(v));
const div = (a, b) => (b > 0 ? a / b : null);

/** American odds to decimal, so "best price" means best payout. */
export function decimalOdds(american) {
  if (american == null) return null;
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

/**
 * @param {object} input
 * @param {Array} input.games        schedule rows for the target week
 * @param {Array} input.playerRows   chalk_player_weeks for season and season-1
 * @param {Array} input.defenseRows  chalk_defense_weeks for season and season-1
 * @param {Array} input.propRows     chalk_prop_snapshots, anytime TD only
 * @param {Map|null} input.roster    player id to { team, position }, or null
 * @param {number} input.season
 * @param {number} input.week
 * @param {(name: string) => string|null} input.toAbbr    Odds API name to abbr
 * @param {(name: string) => string|null} input.nameKey   player name to a join key
 */
export function buildTdBoard({
  games, playerRows, defenseRows, propRows, roster, season, week, toAbbr, nameKey,
}) {
  // Season to date within the target season, falling back to the prior season
  // when the target week is early enough that nothing has been played.
  const seasonToDate = (rows) =>
    rows.filter((r) => Number(r.season) === season && Number(r.week) < week);
  const usingPriorSeason = seasonToDate(playerRows).length === 0;
  const statsSeason = usingPriorSeason ? season - 1 : season;
  const seasonSlice = (rows) =>
    usingPriorSeason ? rows.filter((r) => Number(r.season) === season - 1) : seasonToDate(rows);

  // Everything playable before the target week, oldest first, for last-N windows.
  const chronological = (rows) =>
    rows
      .filter(
        (r) =>
          Number(r.season) === season - 1 ||
          (Number(r.season) === season && Number(r.week) < week),
      )
      .sort((a, b) => Number(a.season) - Number(b.season) || Number(a.week) - Number(b.week));

  // ---- defence aggregates and league ranks ----
  const defByTeam = new Map();
  for (const r of seasonSlice(defenseRows)) {
    if (!defByTeam.has(r.team)) {
      defByTeam.set(r.team, { games: 0, rushTd: 0, passTd: 0, rzTrips: 0, rzTd: 0 });
    }
    const d = defByTeam.get(r.team);
    d.games += 1;
    d.rushTd += n(r.rush_td_allowed);
    d.passTd += n(r.pass_td_allowed);
    d.rzTrips += n(r.rz_trips_allowed);
    d.rzTd += n(r.rz_td_allowed);
  }
  for (const d of defByTeam.values()) {
    d.rushTdPg = div(d.rushTd, d.games);
    d.passTdPg = div(d.passTd, d.games);
    d.rzRate = div(d.rzTd, d.rzTrips);
  }
  // Rank 1 = softest, which is the one that allows the most.
  const rankBy = (key) => {
    const sorted = [...defByTeam.entries()].sort((a, b) => (b[1][key] ?? -1) - (a[1][key] ?? -1));
    return new Map(sorted.map(([team], i) => [team, i + 1]));
  };
  const rushRank = rankBy("rushTdPg");
  const passRank = rankBy("passTdPg");

  // ---- player aggregates ----
  const byPlayer = new Map();
  for (const r of chronological(playerRows)) {
    if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, []);
    byPlayer.get(r.player_id).push(r);
  }
  const seasonByPlayer = new Map();
  for (const r of seasonSlice(playerRows)) {
    if (!seasonByPlayer.has(r.player_id)) seasonByPlayer.set(r.player_id, { rushTd: 0, recTd: 0 });
    const s = seasonByPlayer.get(r.player_id);
    s.rushTd += n(r.rush_td);
    s.recTd += n(r.rec_td);
  }

  // Where each player is NOW, not where they last played.
  const currentTeam = (id, fallback) => roster?.get(id)?.team ?? fallback;
  const currentPos = (id, fallback) => roster?.get(id)?.position ?? fallback;
  let moved = 0;
  for (const [id, rows] of byPlayer) {
    const last = rows[rows.length - 1];
    if (roster?.has(id) && roster.get(id).team !== last.team) moved += 1;
  }

  // ---- props: newest capture per player per book ----
  const latest = new Map();
  for (const p of propRows) {
    const k = `${p.game_id}|${p.player_name}|${p.bookmaker}`;
    const prev = latest.get(k);
    if (!prev || Date.parse(p.captured_at) > Date.parse(prev.captured_at)) latest.set(k, p);
  }
  const propsByGame = new Map();
  for (const p of latest.values()) {
    const home = toAbbr(p.home_team);
    const away = toAbbr(p.away_team);
    if (!home || !away) continue;
    const key = `${away}@${home}`;
    if (!propsByGame.has(key)) propsByGame.set(key, []);
    propsByGame.get(key).push(p);
  }

  const leagueKeys = new Set(playerRows.map((r) => nameKey(r.player_name)).filter(Boolean));
  const unmatchedProps = [];
  const noPrice = [];

  const out = games.map((g) => {
    const key = `${g.away_team}@${g.home_team}`;
    const gameProps = propsByGame.get(key) || [];

    // Best available price per player across books.
    const best = new Map();
    for (const p of gameProps) {
      if (p.outcome !== "Yes") continue;
      const k = nameKey(p.player_name);
      if (!k) continue;
      const d = decimalOdds(p.price);
      const cur = best.get(k);
      if (!cur || (d != null && d > cur.decimal)) {
        best.set(k, { decimal: d, price: p.price, book: p.bookmaker, name: p.player_name });
      }
    }
    for (const [k, v] of best) {
      if (TEAM_DEFENCE.test(v.name)) continue;
      if (!leagueKeys.has(k)) unmatchedProps.push(`${v.name} (${key})`);
    }

    const sides = ["away", "home"].map((which) => {
      const team = which === "away" ? g.away_team : g.home_team;
      const opp = which === "away" ? g.home_team : g.away_team;
      const d = defByTeam.get(opp) ?? null;

      const players = [];
      for (const [playerId, rows] of byPlayer) {
        const last = rows.slice(-LAST_N);
        if (last.length === 0) continue;
        const recent = last[last.length - 1];
        if (currentTeam(playerId, recent.team) !== team) continue;
        const pos = currentPos(playerId, recent.position);
        if (!SKILL.has(pos)) continue;

        const touches = last.reduce((a, r) => a + n(r.rush_att) + n(r.targets), 0);
        const perGame = touches / last.length;
        if (perGame < MIN_TOUCHES) continue;

        const s = seasonByPlayer.get(playerId) || { rushTd: 0, recTd: 0 };
        const k = nameKey(recent.player_name);
        const price = k ? best.get(k) ?? null : null;
        if (gameProps.length && !price) noPrice.push(`${recent.player_name} (${team})`);

        players.push({
          playerId,
          name: recent.player_name,
          pos,
          vs: MATCHUP[pos] || "-",
          seasonRushTd: s.rushTd,
          seasonRecTd: s.recTd,
          l4RushTd: last.reduce((a, r) => a + n(r.rush_td), 0),
          l4RecTd: last.reduce((a, r) => a + n(r.rec_td), 0),
          glPg: last.reduce((a, r) => a + n(r.gl_touches), 0) / last.length,
          rzPg: last.reduce((a, r) => a + n(r.rz_rush_att) + n(r.rz_targets), 0) / last.length,
          touchesPg: perGame,
          price: price ? price.price : null,
          book: price ? price.book : null,
        });
      }

      players.sort((a, b) => b.glPg - a.glPg || b.rzPg - a.rzPg);

      return {
        team,
        opponent: opp,
        defence: d && {
          rushTdPg: d.rushTdPg,
          passTdPg: d.passTdPg,
          rzRate: d.rzRate,
          rzTd: d.rzTd,
          rzTrips: d.rzTrips,
          rushRank: rushRank.get(opp) ?? null,
          passRank: passRank.get(opp) ?? null,
        },
        players,
      };
    });

    return {
      key,
      away: g.away_team,
      home: g.home_team,
      gameday: g.gameday,
      gametime: g.gametime,
      spreadLine: g.spread_line === "" ? null : Number(g.spread_line),
      totalLine: g.total_line === "" ? null : Number(g.total_line),
      hasProps: gameProps.length > 0,
      sides,
    };
  });

  return {
    season,
    week,
    statsSeason,
    usingPriorSeason,
    hasRoster: !!roster,
    moved,
    games: out,
    unmatchedProps: [...new Set(unmatchedProps)].sort(),
    noPrice: [...new Set(noPrice)].sort(),
  };
}
