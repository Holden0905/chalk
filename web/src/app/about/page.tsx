import weights from "@/data/weights.json";

export const metadata = { title: "About · Chalk" };

type Weights = {
  offense: Record<string, number>;
  defense: Record<string, number>;
  special_teams: number;
  scoring_blend: number;
  total_scale: number;
  opponent_adjust_iterations: number;
  home_field: number;
  rating_points_per_sd: number;
  prior_season_blend: number[];
};

const w = weights as unknown as Weights;

// Plain language for each weighted input, so the page describes the rating
// that is actually running rather than one written down once.
const COMPONENT_COPY: Record<string, string> = {
  success_rate: "How often a play gains enough to stay on schedule.",
  epa_per_play: "How much each play moves the expected points.",
  finishing: "Points scored per drive that reaches the opponent 40.",
  field_position: "Where drives start.",
  turnovers: "Giveaways on offence, takeaways on defence.",
};

const SPREAD_ROWS = [
  { season: "2023", games: 256, ours: 10.307, vegas: 9.818 },
  { season: "2024", games: 256, ours: 10.635, vegas: 9.648 },
  { season: "2025", games: 256, ours: 10.627, vegas: 9.959 },
  { season: "All", games: 768, ours: 10.523, vegas: 9.809 },
];

const TOTAL_ROWS = [
  { season: "2023", games: 256, ours: 10.779, vegas: 10.338 },
  { season: "2024", games: 256, ours: 9.823, vegas: 9.723 },
  { season: "2025", games: 256, ours: 10.445, vegas: 10.262 },
  { season: "All", games: 768, ours: 10.349, vegas: 10.107 },
];

const ATS_ROWS = [
  { edge: "1", bets: 610, record: "282-311-17", pct: 47.6 },
  { edge: "2", bets: 464, record: "214-237-13", pct: 47.5 },
  { edge: "3", bets: 318, record: "158-154-6", pct: 50.6 },
  { edge: "4", bets: 205, record: "92-108-5", pct: 46.0 },
  { edge: "5", bets: 139, record: "62-73-4", pct: 45.9 },
  { edge: "6", bets: 92, record: "37-53-2", pct: 41.1 },
];

const OU_ROWS = [
  { edge: "1", bets: 556, record: "281-270-5", pct: 51.0 },
  { edge: "2", bets: 353, record: "190-160-3", pct: 54.3 },
  { edge: "3", bets: 205, record: "111-91-3", pct: 55.0 },
  { edge: "4", bets: 127, record: "67-59-1", pct: 53.2 },
  { edge: "5", bets: 77, record: "38-38-1", pct: 50.0 },
  { edge: "6", bets: 45, record: "20-25-0", pct: 44.4 },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12 first:mt-8">
      <h2 className="chalk text-3xl leading-none font-bold sm:text-4xl">{title}</h2>
      <div className="mt-4 max-w-prose space-y-3 text-[0.9375rem] leading-relaxed text-chalk-soft">
        {children}
      </div>
    </section>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="panel mt-5 overflow-x-auto px-3 py-3 sm:px-4">{children}</div>;
}

export default function AboutPage() {
  const blendToZero = w.prior_season_blend.findIndex((v) => v === 0) + 1;

  return (
    <>
      <h1 className="chalk text-4xl leading-none font-bold sm:text-5xl">About</h1>
      <p className="mt-3 max-w-prose text-sm text-chalk-soft">
        Chalk tracks NFL numbers so I can look at them. It is a lens, not a picker.
      </p>

      <Section title="How the rating is built">
        <p>
          Every team gets a rating each week. It is built from the play by play,
          not from scores. Each input is turned into a z score across the league,
          weighted, and added up. Offence and defence are rated separately. The
          defence side is inverted so a higher number is always better.
        </p>
        <p>
          These are the weights in use right now. They come from weights.json,
          which is the only place they live.
        </p>

        <Panel>
          <table className="tabular w-full text-[0.8125rem]">
            <thead>
              <tr className="label">
                <th className="pb-2 text-left font-medium">Input</th>
                <th className="pb-2 pr-3 text-right font-medium">Weight</th>
                <th className="pb-2 text-left font-medium">What it measures</th>
              </tr>
            </thead>
            <tbody className="text-chalk">
              {Object.entries(w.offense).map(([key, value]) => (
                <tr key={key} className="border-t border-panel-rule">
                  <td className="py-2 pr-3">{key.replace(/_/g, " ")}</td>
                  <td className="py-2 pr-3 text-right">{value.toFixed(2)}</td>
                  <td className="py-2 font-sans text-chalk-soft">{COMPONENT_COPY[key]}</td>
                </tr>
              ))}
              <tr className="border-t border-panel-rule">
                <td className="py-2 pr-3">special teams</td>
                <td className="py-2 pr-3 text-right">{w.special_teams.toFixed(2)}</td>
                <td className="py-2 font-sans text-chalk-soft">
                  Net EPA on field goals, punts, kickoffs and returns.
                </td>
              </tr>
            </tbody>
          </table>
        </Panel>

        <p>
          Offence and defence use the same five weights and each side sums to
          one. Special teams is added on top of the team total at{" "}
          {w.special_teams.toFixed(2)}.
        </p>
        <p>
          Three more settings shape the number. Early in a season the rating
          leans on last year and lets go of it a bit each week, reaching zero by
          week {blendToZero}. Then it adjusts {w.opponent_adjust_iterations} times
          for the quality of opponents faced, so an offence that played hard
          defences is not punished for it. Last, the whole scale is set so one
          rating point means one point of expected margin against an average team
          on a neutral field. Home field is worth {w.home_field.toFixed(1)} points
          on top of that.
        </p>
        <p>
          A rating for a given week only uses games played before that week. That
          is enforced in code and tested by feeding future weeks in and checking
          the rating does not move.
        </p>
      </Section>

      <Section title="What the backtest found">
        <p>
          The rating was run over three seasons, rebuilt fresh each week from only
          what was known at the time, and its number compared to the closing line.
          Mean absolute error is the average miss in points, so lower is better.
        </p>

        <Panel>
          <p className="label mb-2">Spread, mean absolute error</p>
          <table className="tabular w-full text-[0.8125rem]">
            <thead>
              <tr className="label">
                <th className="pb-2 text-left font-medium">Season</th>
                <th className="pb-2 text-right font-medium">Games</th>
                <th className="pb-2 text-right font-medium">Chalk</th>
                <th className="pb-2 text-right font-medium">Close</th>
                <th className="pb-2 text-right font-medium">Diff</th>
              </tr>
            </thead>
            <tbody className="text-chalk">
              {SPREAD_ROWS.map((r) => (
                <tr key={r.season} className="border-t border-panel-rule">
                  <td className="py-1.5">{r.season}</td>
                  <td className="py-1.5 text-right">{r.games}</td>
                  <td className="py-1.5 text-right">{r.ours.toFixed(3)}</td>
                  <td className="py-1.5 text-right">{r.vegas.toFixed(3)}</td>
                  <td className="py-1.5 text-right text-loss">+{(r.ours - r.vegas).toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel>
          <p className="label mb-2">Total, mean absolute error</p>
          <table className="tabular w-full text-[0.8125rem]">
            <thead>
              <tr className="label">
                <th className="pb-2 text-left font-medium">Season</th>
                <th className="pb-2 text-right font-medium">Games</th>
                <th className="pb-2 text-right font-medium">Chalk</th>
                <th className="pb-2 text-right font-medium">Close</th>
                <th className="pb-2 text-right font-medium">Diff</th>
              </tr>
            </thead>
            <tbody className="text-chalk">
              {TOTAL_ROWS.map((r) => (
                <tr key={r.season} className="border-t border-panel-rule">
                  <td className="py-1.5">{r.season}</td>
                  <td className="py-1.5 text-right">{r.games}</td>
                  <td className="py-1.5 text-right">{r.ours.toFixed(3)}</td>
                  <td className="py-1.5 text-right">{r.vegas.toFixed(3)}</td>
                  <td className="py-1.5 text-right text-loss">+{(r.ours - r.vegas).toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <p>
          The closing line wins both, every season. Chalk misses the spread by
          about three quarters of a point more than the market does, and the total
          by a quarter point more.
        </p>
        <p>
          The other way to ask is what happens if you bet the side Chalk likes
          whenever it disagrees with the close by some margin. A break even bet at
          standard juice needs 52.4 percent.
        </p>

        <Panel>
          <p className="label mb-2">Against the spread, 2023 to 2025</p>
          <table className="tabular w-full text-[0.8125rem]">
            <thead>
              <tr className="label">
                <th className="pb-2 text-left font-medium">Edge</th>
                <th className="pb-2 text-right font-medium">Bets</th>
                <th className="pb-2 text-right font-medium">Record</th>
                <th className="pb-2 text-right font-medium">Win</th>
              </tr>
            </thead>
            <tbody className="text-chalk">
              {ATS_ROWS.map((r) => (
                <tr key={r.edge} className="border-t border-panel-rule">
                  <td className="py-1.5">{r.edge}+ pts</td>
                  <td className="py-1.5 text-right">{r.bets}</td>
                  <td className="py-1.5 text-right">{r.record}</td>
                  <td className="py-1.5 text-right text-loss">{r.pct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel>
          <p className="label mb-2">Over and under, 2023 to 2025</p>
          <table className="tabular w-full text-[0.8125rem]">
            <thead>
              <tr className="label">
                <th className="pb-2 text-left font-medium">Edge</th>
                <th className="pb-2 text-right font-medium">Bets</th>
                <th className="pb-2 text-right font-medium">Record</th>
                <th className="pb-2 text-right font-medium">Win</th>
              </tr>
            </thead>
            <tbody className="text-chalk">
              {OU_ROWS.map((r) => (
                <tr key={r.edge} className="border-t border-panel-rule">
                  <td className="py-1.5">{r.edge}+ pts</td>
                  <td className="py-1.5 text-right">{r.bets}</td>
                  <td className="py-1.5 text-right">{r.record}</td>
                  <td className={`py-1.5 text-right ${r.pct >= 52.4 ? "text-win" : "text-loss"}`}>
                    {r.pct.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <p>
          Against the spread it loses at every threshold, and it loses worse the
          more confident it is. That is the opposite of what an edge looks like.
          Totals showed something for a while. On two seasons the win rate rose
          with disagreement and reached 60 percent at the top. Two checks took it
          apart. The totals were swinging about twice as wide as they should, and
          once that was scaled correctly most of the edge went with it. Then a
          third season showed nothing. The scale that fixes one sample does not
          fix the next, which is the tell that it was fitting noise.
        </p>
        <p className="text-chalk">
          So: Chalk does not beat the closing line. It is not a picker. It is a
          way to look at the same numbers the market is looking at, and to see
          where my own number lands next to theirs. When they disagree, the market
          is usually right. That is worth knowing before acting on anything here.
        </p>
      </Section>

      <Section title="How the TD board works">
        <p>
          The touchdown board is a usage board. It does not predict anything. It
          lists, for each game, the skill players averaging at least six touches a
          game over their last four, and puts their scoring chances next to the
          defence they are about to face.
        </p>
        <p>
          The columns that matter are goal line touches and red zone touches per
          game. A goal line touch is a carry or a target from inside the five. A
          red zone touch is one from inside the twenty. Those are the chances a
          touchdown actually comes from, and they hold up better week to week than
          touchdowns themselves.
        </p>
        <p>
          Next to that sits the defence. Rushing touchdowns allowed per game,
          passing touchdowns allowed per game, and how often a drive that reaches
          the red zone against them ends in a score. Rushers are read against the
          rushing number, receivers against the passing one. Running backs get
          both, because they do both.
        </p>
        <p>
          Where a price has been captured, the best anytime touchdown number
          across the books is shown with the book offering it. Prices come from a
          Saturday snapshot, so they are the prices that existed then, not live
          ones.
        </p>
        <p>
          There is no score and no ranking beyond sorting by goal line work. The
          point is to put usage and matchup side by side and let you read them.
        </p>
      </Section>
    </>
  );
}
