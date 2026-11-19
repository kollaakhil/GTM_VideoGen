/**
 * Free, pre-voice estimate of how long a VO line takes to say, so the script gate rejects lines that cannot fit
 * their beat before any TTS or music is bought (13.22).
 *
 * Calibrated on run_8a9c7c9db627 (ElevenLabs turbo v2.5, Rachel): 8 syl → 2.46 s, 9 → 2.09 s, 16 → 3.47 s,
 * 17 with a full stop mid-line → 4.21 s. Model: 0.25 s + syllables / 4.6 per second + 0.2 s per sentence break inside
 * the line. It flags the one line that had to be sped up ×1.14 (est 4.15 s) and passes the three that fit.
 *
 * Recalibrated for Eleven v3 (13.30, same run, Rachel): 2.51 s, 2.59 s, 3.63 s and 4.60 s for the four lines; v3 holds
 * a 0.41 s pause at a full stop (Turbo ~0.2), and reads "drinkolipop dot com" slowly. Added: 0.4 s per
 * sentence break and 0.45 s per spoken domain. Commas are not charged: the 16-syllable line with two commas took
 * 3.63 s, and a comma charge would have rejected a line that fit. The CTA line ("Half off two-plus cases. Shop at
 * drinkolipop.com.", 4.6 s in a 4 s beat, sped up ×1.24) now fails the free script gate instead of the paid voice gate.
 */
export const SYLLABLES_PER_SEC = 4.6;
export const SPEECH_LEAD_SEC = 0.25;
/** Voice starts 0.15 s into the shot and must end 0.15 s before the cut (video.ts `room = seconds - 0.3`). */
export const BEAT_PADDING_SEC = 0.3;
/** The voice gate scores a ×1.05 speed-up at 8/10 (its pass mark); allow the same here, no more. */
export const MAX_TEMPO = 1.05;
export const SENTENCE_PAUSE_SEC = 0.4;
export const DOMAIN_SEC = 0.45;

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

export function numberWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n);
  n = Math.floor(n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
  if (n < 1000) return ONES[Math.floor(n / 100)] + " hundred" + (n % 100 ? " " + numberWords(n % 100) : "");
  if (n < 1_000_000) return numberWords(Math.floor(n / 1000)) + " thousand" + (n % 1000 ? " " + numberWords(n % 1000) : "");
  return "a lot";
}

function wordSyllables(w: string): number {
  if (!w) return 0;
  if (/^[A-Z]{2,4}$/.test(w)) return w.length; // spelled-out acronym (USA, FAQ)
  let s = w.toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return 0;
  if (s.length <= 3) return 1;
  // Silent endings: "-es" except after s/z/c/g/x/ch/sh ("cases" = 2), "-ed" except after t/d, final "-e" (not "-le").
  s = s.replace(/(?<![aeiouyszcgx]|ch|sh)es$/, "").replace(/(?<![td])ed$/, "").replace(/([^laeiouy])e$/, "$1").replace(/^y/, "");
  const groups = s.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** The line as it will be spoken: numbers, %, +, $, and domains expanded. */
export function spokenForm(line: string): string {
  return line
    .replace(/\$(\d+)/g, (_, n) => `${numberWords(+n)} dollars`)
    .replace(/(\d+)\s*%/g, (_, n) => `${numberWords(+n)} percent`)
    .replace(/(\d+)\s*\+/g, (_, n) => `${numberWords(+n)} plus`)
    .replace(/(\d+)\s*g\b/g, (_, n) => `${numberWords(+n)} grams`)
    .replace(/\d+/g, (n) => numberWords(+n))
    .replace(/\.(com|co|io|ai|net|org|shop|store)\b/gi, " dot $1")
    .replace(/[-/]/g, " ");
}

export function syllables(line: string): number {
  return spokenForm(line).split(/\s+/).reduce((sum, w) => sum + wordSyllables(w.replace(/[^\w]/g, "")), 0);
}

export function spokenSeconds(line: string): number {
  const n = syllables(line);
  const breaks = (line.trim().replace(/\.(?=[a-z])/gi, "").match(/[.?!]+(?=\s+\S)/g) ?? []).length;
  const domains = (line.match(/\.(com|co|io|ai|net|org|shop|store)\b/gi) ?? []).length;
  return n ? SPEECH_LEAD_SEC + n / SYLLABLES_PER_SEC + breaks * SENTENCE_PAUSE_SEC + domains * DOMAIN_SEC : 0;
}

/** Problem text when a line will not fit its beat at natural speed, else null. */
export function beatFitProblem(line: string, beatSeconds: number): string | null {
  if (!line.trim()) return null;
  const room = Math.max(0.5, beatSeconds - BEAT_PADDING_SEC);
  const need = spokenSeconds(line);
  if (need <= room * MAX_TEMPO) return null;
  const maxSyl = Math.floor((room * MAX_TEMPO - SPEECH_LEAD_SEC) * SYLLABLES_PER_SEC);
  return `takes about ${need.toFixed(1)}s to say (${syllables(line)} syllables) but the beat leaves ${room.toFixed(1)}s; cut it to ${maxSyl} syllables or fewer`;
}
