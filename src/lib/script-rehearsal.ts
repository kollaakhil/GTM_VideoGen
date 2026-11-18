import type { AdScript, ScriptBeat } from "./types";

export function rehearsalMetrics(b: Pick<ScriptBeat, "vo" | "onScreen">) {
  const spoken = b.vo.replace(/[$£€]\s?\d[\d,.]*/g, "a hundred dollars").replace(/\b\d+\+?/g, "a number");
  const words = (s: string) => s.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  const lines: string[] = [];
  for (const word of b.onScreen.trim().split(/\s+/).filter(Boolean)) {
    const last = lines.at(-1);
    if (last && [...last, " ", ...word].length <= 22) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return {
    speakingSeconds: Math.round((words(spoken) / 2.5 + (spoken.match(/[.!?,;:](?=\s)/g)?.length ?? 0) * 0.15) * 10) / 10,
    readingSeconds: b.onScreen.trim() ? Math.max(1.5, words(b.onScreen) / 3 + 0.4) : 0,
    lines,
    fits: lines.length <= 2 && lines.every((line) => [...line].length <= 22),
  };
}

export function rehearseScript(script: AdScript) {
  return script.beats.flatMap((b, i) => {
    const m = rehearsalMetrics(b);
    const label = `Beat ${i + 1}`;
    const issues = [];
    if (m.speakingSeconds > b.seconds) issues.push(`${label}: VO needs about ${m.speakingSeconds}s; trim it or allow more time.`);
    if (!m.fits) issues.push(`${label}: overlay needs more than two phone-safe lines. Move extra copy into another beat or VO.`);
    if (m.readingSeconds > b.seconds) issues.push(`${label}: overlay cannot be read in ${b.seconds}s. Reduce the text or hold the shot longer.`);
    return issues;
  });
}
