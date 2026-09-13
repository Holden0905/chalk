require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const teams = require('./teams.js');

function requireEnv(name) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
  return raw.trim();
}

// ESPN's public site API. No key, no documented contract, no rate limit that
// has ever been hit at this volume -- roughly fifty requests a run.
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';

/**
 * ESPN writes team names exactly as The Odds API does, for all 32 clubs. This
 * still routes through teams.js rather than passing the string through, so that
 * an unfamiliar name returns null and is counted instead of being written to
 * the database as a team nothing else in Chalk can join to.
 */
function espnTeamToOdds(displayName) {
  if (!displayName) return null;
  return teams.toOddsName(teams.toAbbr(String(displayName).trim()));
}

// Descending severity, as a bettor reads a report. The four game-day
// designations come first: out is the most severe thing that can still be
// called a question, and probable the least. Injured reserve and suspension sit
// after them because they are not this week's news -- they are settled
// absences, known for weeks, and nothing about them moves a number on Sunday.
const STATUS_ORDER = [
  'out',
  'doubtful',
  'questionable',
  'probable',
  'injured reserve',
  'suspension',
];

// The absence of a designation. Two thirds of ESPN's feed is this, and storing
// it would be storing "nothing is wrong with this player".
const SKIP_STATUS = new Set(['active']);

function normalizeStatus(raw) {
  if (!raw) return null;
  return String(raw).trim().toLowerCase();
}

/** Position in STATUS_ORDER, with anything unrecognised sorting last. */
function statusRank(status) {
  const i = STATUS_ORDER.indexOf(normalizeStatus(status));
  return i === -1 ? STATUS_ORDER.length : i;
}

/**
 * Quarterbacks first -- one quarterback is worth more of the number than the
 * rest of the report combined -- then by severity, then alphabetically so the
 * order is stable between captures.
 */
function sortInjuries(rows) {
  return [...rows].sort((a, b) => {
    const aQb = a.position === 'QB' ? 0 : 1;
    const bQb = b.position === 'QB' ? 0 : 1;
    if (aQb !== bQb) return aQb - bQb;
    const rank = statusRank(a.status) - statusRank(b.status);
    if (rank !== 0) return rank;
    return String(a.player_name).localeCompare(String(b.player_name));
  });
}

/** ESPN's /injuries payload to chalk_injuries rows. */
function injuryRows(payload, { capturedAt, season, week }) {
  const rows = [];
  const unknownTeams = new Set();
  for (const group of payload?.injuries || []) {
    const team = espnTeamToOdds(group.displayName);
    if (!team) {
      if (group.displayName) unknownTeams.add(group.displayName);
      continue;
    }
    for (const item of group.injuries || []) {
      const status = normalizeStatus(item.status);
      if (!status || SKIP_STATUS.has(status)) continue;
      const athlete = item.athlete || {};
      const name = athlete.displayName;
      if (!name) continue;
      rows.push({
        captured_at: capturedAt,
        season,
        week,
        team,
        player_name: name,
        position: athlete.position?.abbreviation || null,
        status,
        detail: noteFor(item),
      });
    }
  }
  return { rows: dedupe(rows), unknownTeams: [...unknownTeams] };
}

// ESPN fills these in when it has nothing more specific, and they are worse
// than saying nothing.
const VAGUE = new Set(['not specified', 'unspecified', 'undisclosed', '']);

const specific = (v) => {
  const s = String(v ?? '').trim();
  return s && !VAGUE.has(s.toLowerCase()) ? s : null;
};

/** "Knee - ACL, Surgery" when ESPN gives no written note. */
function describeInjury(details) {
  if (!details) return null;
  // type is the body part, detail the treatment. location is skipped: it is the
  // coarser region and merely repeats type, as "Knee" under a location of "Leg".
  const parts = [specific(details.type), specific(details.detail), specific(details.side)];
  const kept = parts.filter(Boolean);
  return kept.length ? kept.join(', ') : null;
}

/**
 * About a quarter of ESPN's shortComments are not a comment at all -- they are
 * the status again, lower cased: "ir", "out", "questionable", "nfi-r". A real
 * note is a written sentence, so anything without a space in it is treated as
 * the placeholder it is and the body part is used instead. Otherwise the page
 * would read "Turner | DT | out | out".
 */
function isWrittenNote(text) {
  const s = String(text ?? '').trim();
  return s.length > 0 && /\s/.test(s);
}

/** The best available description of what is wrong, or null. */
function noteFor(item) {
  const short = item?.shortComment;
  // The short note is the useful one when it is real: one sentence, already
  // written for a reader. The long one runs to a paragraph of fantasy advice.
  if (isWrittenNote(short)) return String(short).trim();
  return describeInjury(item?.details);
}

/**
 * One row per player per capture. ESPN occasionally lists the same athlete
 * twice under one club; the unique constraint would reject the whole batch, so
 * the first entry wins here instead.
 */
function dedupe(rows) {
  const seen = new Map();
  for (const r of rows) {
    const key = `${r.team}|${r.player_name}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  return [...seen.values()];
}

const HOURS_6 = 6 * 3600 * 1000;

/**
 * Match an ESPN event to one of our Odds API games on both team names and
 * kickoff. Names alone would be ambiguous for a pair that meets twice in a
 * season; kickoff alone would be ambiguous for the eight games that start at
 * the same minute.
 */
function matchEvent(event, oddsGames, toleranceMs = HOURS_6) {
  const home = espnTeamToOdds(event.home);
  const away = espnTeamToOdds(event.away);
  if (!home || !away || !event.date) return null;
  const when = Date.parse(event.date);
  if (!Number.isFinite(when)) return null;

  let best = null;
  for (const g of oddsGames) {
    if (g.home_team !== home || g.away_team !== away) continue;
    const gap = Math.abs(Date.parse(g.commence_time) - when);
    if (!Number.isFinite(gap) || gap > toleranceMs) continue;
    if (!best || gap < best.gap) best = { game: g, gap };
  }
  return best ? best.game : null;
}

/** ESPN preview stories are HTML. Keep the sentences, drop the markup. */
function stripHtml(html) {
  if (!html) return null;
  const text = String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || null;
}

/** The fields of a news article worth keeping, without the image manifests. */
function slimArticle(a) {
  if (!a) return null;
  return {
    id: a.id ?? null,
    type: a.type ?? null,
    headline: a.headline ?? null,
    description: a.description ?? null,
    published: a.published ?? a.lastModified ?? null,
    link: a.links?.web?.href ?? null,
    teams: (a.categories || [])
      .filter((c) => c.type === 'team')
      .map((c) => c.description || c.team?.description)
      .filter(Boolean),
  };
}

/** Does this article carry a team category for either side of the game? */
function mentionsEither(article, homeName, awayName) {
  const named = new Set(article.teams || []);
  return named.has(homeName) || named.has(awayName);
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${res.statusText}`);
  return res.json();
}

/** A few at a time, so a run is quick without hammering a free endpoint. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function main() {
  const SUPABASE_URL = requireEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_KEY = requireEnv('SUPABASE_SERVICE_KEY');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // One timestamp for the whole run, so every row of this capture shares it and
  // "the latest capture" is a single value rather than a spread of seconds.
  const capturedAt = new Date().toISOString();

  console.log('Fetching scoreboard and league injury report...');
  const [scoreboard, injuries, leagueNews] = await Promise.all([
    getJson(`${ESPN}/scoreboard`),
    getJson(`${ESPN}/injuries`),
    getJson(`${ESPN}/news`),
  ]);

  const season = Number(scoreboard?.season?.year) || null;
  const week = Number(scoreboard?.week?.number) || null;
  console.log(`Season ${season}, week ${week}.`);

  // --- injuries -------------------------------------------------------------
  const { rows: injuryBatch, unknownTeams } = injuryRows(injuries, { capturedAt, season, week });
  if (unknownTeams.length) {
    console.warn(`Unrecognised ESPN team names, skipped: ${unknownTeams.join(', ')}`);
  }

  if (injuryBatch.length) {
    const { error } = await supabase
      .from('chalk_injuries')
      .upsert(injuryBatch, { onConflict: 'captured_on,team,player_name' });
    if (error) {
      console.error(`Injury upsert failed: ${error.message}`);
      process.exit(1);
    }
  }
  const byStatus = {};
  for (const r of injuryBatch) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  console.log(
    `Injuries: ${injuryBatch.length} rows across ${new Set(injuryBatch.map((r) => r.team)).size} teams ` +
      `(${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(', ')}).`,
  );

  // --- games ----------------------------------------------------------------
  // Only games that have not kicked off. A finished game's preview is no longer
  // context for anything.
  const events = (scoreboard?.events || [])
    .filter((e) => e.status?.type?.state === 'pre')
    .map((e) => {
      const comp = e.competitions?.[0] || {};
      const side = (which) =>
        (comp.competitors || []).find((c) => c.homeAway === which)?.team || {};
      return {
        id: String(e.id),
        date: e.date,
        home: side('home').displayName,
        away: side('away').displayName,
        homeEspnId: side('home').id ? String(side('home').id) : null,
        awayEspnId: side('away').id ? String(side('away').id) : null,
      };
    });
  console.log(`${events.length} upcoming events on the scoreboard.`);

  if (events.length === 0) {
    console.log('No upcoming games; nothing to write to chalk_game_news.');
    return;
  }

  // Our own games for the same window, so an ESPN event can be given a game_id.
  const earliest = new Date(Math.min(...events.map((e) => Date.parse(e.date))) - HOURS_6);
  const latest = new Date(Math.max(...events.map((e) => Date.parse(e.date))) + HOURS_6);
  const { data: snapshotRows, error: snapErr } = await supabase
    .from('chalk_odds_snapshots')
    .select('game_id,home_team,away_team,commence_time')
    .gte('commence_time', earliest.toISOString())
    .lte('commence_time', latest.toISOString());
  if (snapErr) {
    console.error(`Reading chalk_odds_snapshots failed: ${snapErr.message}`);
    process.exit(1);
  }
  const oddsGames = [...new Map((snapshotRows || []).map((r) => [r.game_id, r])).values()];
  console.log(`${oddsGames.length} of our own games in the same window.`);

  // --- per-team news, fetched once per team rather than once per game --------
  const teamIds = [...new Set(events.flatMap((e) => [e.homeEspnId, e.awayEspnId]).filter(Boolean))];
  const teamNews = new Map();
  await mapLimit(teamIds, 4, async (id) => {
    try {
      const payload = await getJson(`${ESPN}/news?team=${id}`);
      teamNews.set(id, (payload?.articles || []).map(slimArticle).filter(Boolean));
    } catch (err) {
      console.warn(`  team news ${id} failed: ${err.message}`);
      teamNews.set(id, []);
    }
  });

  const leagueArticles = (leagueNews?.articles || []).map(slimArticle).filter(Boolean);

  // --- per-game summaries ---------------------------------------------------
  const newsRows = [];
  const unmatched = [];
  await mapLimit(events, 4, async (event) => {
    const game = matchEvent(event, oddsGames);
    if (!game) {
      unmatched.push(`${event.away} at ${event.home}`);
      return;
    }

    let summary = null;
    try {
      summary = await getJson(`${ESPN}/summary?event=${event.id}`);
    } catch (err) {
      console.warn(`  summary ${event.id} failed: ${err.message}`);
    }

    const article = summary?.article || null;
    const items = [];
    const seen = new Set();
    for (const a of [
      ...(teamNews.get(event.homeEspnId) || []),
      ...(teamNews.get(event.awayEspnId) || []),
      ...leagueArticles.filter((a) => mentionsEither(a, event.home, event.away)),
      ...(summary?.news?.articles || [])
        .map(slimArticle)
        .filter((a) => a && mentionsEither(a, event.home, event.away)),
    ]) {
      const key = String(a.id ?? a.link ?? a.headline);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(a);
    }
    items.sort((a, b) => String(b.published ?? '').localeCompare(String(a.published ?? '')));

    const headline = article?.headline || items[0]?.headline || null;
    const preview = article?.description || items[0]?.description || null;

    newsRows.push({
      captured_at: capturedAt,
      season,
      week,
      game_id: game.game_id,
      espn_event_id: event.id,
      headline,
      preview,
      raw: {
        event: {
          id: event.id,
          date: event.date,
          home: espnTeamToOdds(event.home),
          away: espnTeamToOdds(event.away),
          venue: summary?.gameInfo?.venue?.fullName ?? null,
          weather: summary?.gameInfo?.weather ?? null,
        },
        article: article
          ? {
              ...slimArticle(article),
              // The preview story is the richest text ESPN publishes about a
              // specific game, and the reason this table exists at all.
              story: stripHtml(article.story)?.slice(0, 8000) ?? null,
            }
          : null,
        news: items,
        predictor: summary?.predictor
          ? {
              home: summary.predictor.homeTeam?.gameProjection ?? null,
              away: summary.predictor.awayTeam?.gameProjection ?? null,
            }
          : null,
        pickcenter: (summary?.pickcenter || []).map((p) => ({
          provider: p.provider?.name ?? null,
          spread: p.spread ?? null,
          overUnder: p.overUnder ?? null,
          homeMl: p.homeTeamOdds?.moneyLine ?? null,
          awayMl: p.awayTeamOdds?.moneyLine ?? null,
        })),
      },
    });
  });

  if (unmatched.length) {
    console.warn(
      `No Odds API game matched, skipped: ${unmatched.join('; ')}. ` +
        'Run npm run snapshot first if the week has not been captured yet.',
    );
  }

  if (newsRows.length) {
    const { error } = await supabase
      .from('chalk_game_news')
      .upsert(newsRows, { onConflict: 'captured_on,game_id' });
    if (error) {
      console.error(`Game news upsert failed: ${error.message}`);
      process.exit(1);
    }
  }
  const withPreview = newsRows.filter((r) => r.raw.article?.story).length;
  console.log(
    `Game news: ${newsRows.length} rows, ${withPreview} with a preview story, ` +
      `${newsRows.reduce((a, r) => a + r.raw.news.length, 0)} news items in total.`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  espnTeamToOdds, normalizeStatus, statusRank, sortInjuries, injuryRows,
  matchEvent, stripHtml, slimArticle, mentionsEither, describeInjury, dedupe,
  noteFor, isWrittenNote,
  STATUS_ORDER, SKIP_STATUS, ESPN,
};
