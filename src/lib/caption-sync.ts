import type { QualityFinding } from "./types";

/**
 * Word-by-word check of what the narrator says against what the captions show, using whisper word timings.
 * A WER on the whole script hides "the caption says 5g but you hear 'five grams' two seconds later"; this compares
 * each caption cue with the words heard while it is on screen.
 */
export type TimedWord = { word: string; start: number; end: number };
export type CaptionCue = { start: number; end: number; text: string };

const NUM: Record<string, string> = { zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", fifty: "50", fortyfive: "45", forty: "40" };
const UNIT: Record<string, string> = { g: "grams", gram: "grams", "%": "percent", pct: "percent", cal: "calories", calorie: "calories" };

/** Lowercase tokens; numbers and common units spoken or written either way compare equal ("5g" = "five grams"). */
export function tokens(text: string): string[] {
  return text.toLowerCase().replace(/[’']/g, "").replace(/(\d)(g|%|cal)\b/g, "$1 $2").replace(/%/g, " % ").replace(/forty[\s-]five/g, "fortyfive")
    .split(/[^\p{L}\p{N}%]+/u).filter(Boolean).map((t) => NUM[t] ?? UNIT[t] ?? t.replace(/s$/, "")).map((t) => (t === "gram" ? "grams" : t));
}

/** LCS alignment: which expected words were heard, which were missed, and which heard words were extra. */
export function alignWords(expected: string[], heard: string[]) {
  const m = expected.length, n = heard.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = expected[i] === heard[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const missing: string[] = [], extra: string[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (expected[i] === heard[j]) { i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) missing.push(expected[i++]); else extra.push(heard[j++]);
  }
  missing.push(...expected.slice(i));
  extra.push(...heard.slice(j));
  return { matched: dp[0][0], missing, extra };
}

export type CueSync = { start: number; end: number; text: string; coverage: number; missing: string[]; extra: string[] };

/** Per caption cue, the share of its words heard while it is on screen (± slack seconds). */
export function captionSync(cues: CaptionCue[], words: TimedWord[], slack = 0.35): CueSync[] {
  return cues.filter((c) => c.text.trim()).map((c) => {
    const exp = tokens(c.text);
    const heard = tokens(words.filter((w) => w.start >= c.start - slack && w.start < c.end + slack).map((w) => w.word).join(" "));
    const a = alignWords(exp, heard);
    return { start: c.start, end: c.end, text: c.text, coverage: exp.length ? a.matched / exp.length : 1, missing: a.missing, extra: a.extra };
  });
}

/** Findings for out-of-sync or mismatched captions, and a 0–10 score for the rubric. */
export function captionSyncFindings(sync: CueSync[]): { findings: QualityFinding[]; score: number | null } {
  if (!sync.length) return { findings: [], score: null };
  const findings: QualityFinding[] = sync.filter((s) => s.coverage < 0.8).map((s) => ({
    kind: "speech", at: s.start, expected: `Caption “${s.text}” heard while it is on screen`,
    observed: `${Math.round(s.coverage * 100)}% of its words heard in ${s.start.toFixed(1)}–${s.end.toFixed(1)}s; missing: ${s.missing.slice(0, 6).join(" ") || "none"}${s.extra.length ? `; heard instead: ${s.extra.slice(0, 6).join(" ")}` : ""}`,
    status: s.coverage < 0.6 ? "fail" : "review",
  }));
  const mean = sync.reduce((t, s) => t + s.coverage, 0) / sync.length;
  return { findings, score: Math.round(Math.max(0, Math.min(10, mean * 10 - findings.filter((f) => f.status === "fail").length)) * 10) / 10 };
}
