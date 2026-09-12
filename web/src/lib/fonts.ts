import {
  Barlow_Condensed,
  Caveat,
  Courier_Prime,
  Covered_By_Your_Grace,
  Just_Another_Hand,
  Kalam,
  Nothing_You_Could_Do,
  Rock_Salt,
  Shadows_Into_Light,
} from "next/font/google";

// ─────────────────────────────────────────────────────────────────────────────
// The app's display face. Change the function called on the next line to swap
// it everywhere. See /fonts to compare candidates.
// ─────────────────────────────────────────────────────────────────────────────
export const display = Rock_Salt({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

// Condensed sans for everything that is not chalk and not a number in a slip.
export const condensed = Barlow_Condensed({
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-condensed",
  display: "swap",
});

// Typewriter for the slips, so columns line up like a typed betting slip.
export const typewriter = Courier_Prime({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-typewriter",
  display: "swap",
});

// ── Candidates, loaded only by the /fonts comparison route ──────────────────
// Rock Salt stays first as the incumbent to compare the thinner faces against.
const rockSalt = Rock_Salt({ weight: "400", subsets: ["latin"], variable: "--font-c1", display: "swap" });
const justAnotherHand = Just_Another_Hand({ weight: "400", subsets: ["latin"], variable: "--font-c2", display: "swap" });
const kalam = Kalam({ weight: "300", subsets: ["latin"], variable: "--font-c3", display: "swap" });
const caveat = Caveat({ weight: "400", subsets: ["latin"], variable: "--font-c4", display: "swap" });
const coveredByYourGrace = Covered_By_Your_Grace({ weight: "400", subsets: ["latin"], variable: "--font-c5", display: "swap" });
const shadowsIntoLight = Shadows_Into_Light({ weight: "400", subsets: ["latin"], variable: "--font-c6", display: "swap" });
const nothingYouCouldDo = Nothing_You_Could_Do({ weight: "400", subsets: ["latin"], variable: "--font-c7", display: "swap" });

export const CANDIDATES = [
  { key: "Rock_Salt", label: "Rock Salt", note: "in use now", font: rockSalt, cssVar: "--font-c1" },
  { key: "Just_Another_Hand", label: "Just Another Hand", note: "", font: justAnotherHand, cssVar: "--font-c2" },
  { key: "Kalam", label: "Kalam 300", note: "weight 300", font: kalam, cssVar: "--font-c3" },
  { key: "Caveat", label: "Caveat", note: "", font: caveat, cssVar: "--font-c4" },
  { key: "Covered_By_Your_Grace", label: "Covered By Your Grace", note: "", font: coveredByYourGrace, cssVar: "--font-c5" },
  { key: "Shadows_Into_Light", label: "Shadows Into Light", note: "", font: shadowsIntoLight, cssVar: "--font-c6" },
  { key: "Nothing_You_Could_Do", label: "Nothing You Could Do", note: "", font: nothingYouCouldDo, cssVar: "--font-c7" },
] as const;
