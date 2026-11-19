import { spokenForm } from "./speech-budget";

/**
 * One canonical spelling for "what was said", used by every final-QA speech check (13.23).
 *
 * The voice is right but the ASR transcript spells it its own way: "50% off 2+" for "fifty percent off two-plus",
 * "ollie pop" / "ollipop" for OLIPOP, "drinkaliepop.com" for drinkolipop.com. Comparing raw spellings scored a clean
 * mix WER 23% and "voice vs script 0/10" (run_8a9c7c9db627 take 1). Both sides are expanded to spoken words
 * (spokenForm), and heard 1–3 token windows within 2 edits (3 for 10+ letters) of a coined brand term from the
 * script are mapped to that term. Ordinary words are never changed, so real mis-speech still fails.
 */
export function canonWords(text: string): string[] {
  return spokenForm(text).normalize("NFKC").toLowerCase().replace(/[’']/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Coined terms in the expected text that contain the brand ("olipop", "drinkolipop"). */
export function brandTerms(expected: string, brand = ""): string[] {
  const b = canonWords(brand).join("");
  if (b.length < 5) return [];
  return [...new Set([b, ...canonWords(expected).filter((w) => w.includes(b))])];
}

function levenshtein(a: string, b: string) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length];
}

/** Merge heard token windows that are a near spelling of a brand term. Returns [canonical token, source index]. */
export function canonTokens(heard: string[], terms: string[]): { word: string; from: number }[] {
  const out: { word: string; from: number }[] = [];
  for (let i = 0; i < heard.length;) {
    let hit: { word: string; k: number } | null = null;
    for (let k = 3; k >= 1 && !hit; k--) {
      if (i + k > heard.length) continue;
      const joined = heard.slice(i, i + k).join("");
      for (const t of terms) {
        if (joined === t || (joined.length >= 4 && levenshtein(joined, t) <= (t.length >= 10 ? 3 : 2))) { hit = { word: t, k }; break; }
      }
    }
    if (hit) { out.push({ word: hit.word, from: i }); i += hit.k; } else { out.push({ word: heard[i], from: i }); i++; }
  }
  return out;
}

/** Canonical heard text, ready to compare with `canonWords(expected).join(" ")`. */
export function canonHeard(heard: string, expected: string, brand = ""): string {
  return canonTokens(canonWords(heard), brandTerms(expected, brand)).map((t) => t.word).join(" ");
}

export const canonExpected = (expected: string) => canonWords(expected).join(" ");

export function sameCanon(heard: string, expected: string, brand = "") {
  return canonHeard(heard, expected, brand) === canonExpected(expected);
}
