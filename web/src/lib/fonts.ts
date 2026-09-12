import {
  Barlow_Condensed,
  Courier_Prime,
  Fredericka_the_Great,
  Gochi_Hand,
  Londrina_Solid,
  Permanent_Marker,
  Rock_Salt,
  Walter_Turncoat,
} from "next/font/google";

// ─────────────────────────────────────────────────────────────────────────────
// The app's display face. Change the function called on the next line to swap
// it everywhere; every candidate below has a 400 weight, so nothing else moves.
// Candidates: Permanent_Marker, Rock_Salt, Walter_Turncoat, Gochi_Hand,
// Fredericka_the_Great, Londrina_Solid. See /fonts to compare them.
// ─────────────────────────────────────────────────────────────────────────────
export const display = Permanent_Marker({
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
const permanentMarker = Permanent_Marker({ weight: "400", subsets: ["latin"], variable: "--font-c1", display: "swap" });
const rockSalt = Rock_Salt({ weight: "400", subsets: ["latin"], variable: "--font-c2", display: "swap" });
const walterTurncoat = Walter_Turncoat({ weight: "400", subsets: ["latin"], variable: "--font-c3", display: "swap" });
const gochiHand = Gochi_Hand({ weight: "400", subsets: ["latin"], variable: "--font-c4", display: "swap" });
const frederickaTheGreat = Fredericka_the_Great({ weight: "400", subsets: ["latin"], variable: "--font-c5", display: "swap" });
const londrinaSolid = Londrina_Solid({ weight: "400", subsets: ["latin"], variable: "--font-c6", display: "swap" });

export const CANDIDATES = [
  { key: "Permanent_Marker", label: "Permanent Marker", font: permanentMarker, cssVar: "--font-c1" },
  { key: "Rock_Salt", label: "Rock Salt", font: rockSalt, cssVar: "--font-c2" },
  { key: "Walter_Turncoat", label: "Walter Turncoat", font: walterTurncoat, cssVar: "--font-c3" },
  { key: "Gochi_Hand", label: "Gochi Hand", font: gochiHand, cssVar: "--font-c4" },
  { key: "Fredericka_the_Great", label: "Fredericka the Great", font: frederickaTheGreat, cssVar: "--font-c5" },
  { key: "Londrina_Solid", label: "Londrina Solid", font: londrinaSolid, cssVar: "--font-c6" },
] as const;
