import type { ShotSheet, SheetShot, StyleRule } from "@/lib/shot-sheet";
import { timingIssues } from "./timing";

/**
 * Check 1 of 3: the shot sheet gate, run before anything renders (PLAYBOOK 14.3). Deterministic, free and instant:
 * the clock adds up, every beat has a camera and a sound, the style rules hold, and every claim on screen or in the
 * VO is in the verified facts. Errors block rendering; warnings are shown and don't.
 */
export type GateIssue = { level: "error" | "warn"; text: string; shot?: number; rule?: string };
export type GateResult = { pass: boolean; issues: GateIssue[]; checkedAt: string };

const dur = (s: SheetShot) => s.end - s.start;
const isCard = (s: SheetShot) => s.engine === "remotion";

const norm = (t: string) =>
  t.toLowerCase()
    .replace(/(\d)\s*m\b/g, "$1 million").replace(/(\d)\s*k\b/g, "$1 thousand").replace(/(\d)\s*b\b/g, "$1 billion")
    .replace(/no\.\s*1|number one|number 1/g, "#1")
    .replace(/[,\u2009]/g, "").replace(/\s+/g, " ");

/** Numbers, money, percentages, multipliers and ranks in a line ("#1", "$3", "1 million", "32%", "3x"). */
export function claimTokens(text: string): string[] {
  const t = norm(text);
  const out = new Set<string>();
  for (const m of t.matchAll(/#\d+|\$\d+(?:\.\d+)?|\d+(?:\.\d+)?\s?(?:%|x\b|million|billion|thousand)|\b\d+(?:\.\d+)?\b/g)) out.add(m[0].replace(/\s/g, ""));
  return [...out];
}

const SUPERLATIVE = /\b(fastest|best|smartest|most (?:powerful|advanced|capable|intelligent)|world'?s first|first ever|unmatched|unbeatable|leading|#1|number one)\b/i;

/** Phrases the facts mark as unverified (`Not verified ... "3x faster than Carbon", "60% lower cost"`). */
export function bannedPhrases(facts: string): string[] {
  const out: string[] = [];
  for (const line of facts.split("\n")) {
    if (!/not verified|don'?t use|do not use|unverified/i.test(line)) continue;
    for (const m of line.matchAll(/["“]([^"”]{3,80})["”]/g)) out.push(m[1].toLowerCase());
  }
  return out;
}

export function claimIssues(sheet: ShotSheet, facts: string): GateIssue[] {
  const issues: GateIssue[] = [];
  const base = norm(facts);
  const baseTokens = new Set(claimTokens(facts));
  const banned = bannedPhrases(facts);
  const lines: { shot?: number; where: string; text: string }[] = [];
  for (const s of sheet.shots) {
    if (s.text?.copy) lines.push({ shot: s.n, where: "on-screen text", text: s.text.copy });
    if (s.audio.vo) lines.push({ shot: s.n, where: "VO", text: s.audio.vo });
    if (s.blender?.label) lines.push({ shot: s.n, where: "label", text: s.blender.label });
  }
  lines.push({ where: "end card", text: [sheet.endCard.title, sheet.endCard.line, sheet.endCard.footer].join(" · ") });
  for (const l of lines) {
    const low = norm(l.text);
    for (const b of banned) if (low.includes(norm(b))) issues.push({ level: "error", shot: l.shot, text: `${l.where} uses "${b}", which the facts mark as unverified.` });
    for (const tok of claimTokens(l.text)) {
      if (/^\d{1,2}$/.test(tok) && !/[#$%x]/.test(tok) && Number(tok) < 11 && !baseTokens.has(tok)) continue; // bare small numbers ("4 thinking levels" is checked by the phrase rule below)
      if (!baseTokens.has(tok) && !base.includes(tok)) issues.push({ level: "error", shot: l.shot, text: `${l.where} claims "${tok}" ("${l.text.slice(0, 60)}"), which isn't in the verified facts.` });
    }
    const sup = l.text.match(SUPERLATIVE)?.[0];
    if (sup && !base.includes(norm(sup))) issues.push({ level: "error", shot: l.shot, text: `${l.where} says "${sup}", which the verified facts don't support.` });
  }
  return issues;
}

export function ruleIssues(sheet: ShotSheet, rules: StyleRule[]): GateIssue[] {
  const out: GateIssue[] = [];
  const pics = sheet.shots.filter((s) => !isCard(s));
  for (const r of rules) {
    const bad = (text: string, shot?: number) => out.push({ level: "error", rule: r.id, shot, text: `Rule "${r.text}": ${text}` });
    switch (r.check) {
      case "push_in":
        for (const s of pics) if (!/push|dolly in|creep|move in|track in/i.test(s.camera.move)) bad(`shot ${s.n} moves "${s.camera.move}", not a slow push-in.`, s.n);
        break;
      case "void_background":
        for (const s of pics) if (s.engine !== "blender" && !/black|void|dark/i.test(`${s.lighting} ${s.framing} ${s.prompt ?? ""}`)) bad(`shot ${s.n} doesn't put the subject on a black void.`, s.n);
        break;
      case "foley_first":
        if (sheet.audioMode !== "foley") bad("the sheet uses voiceover, not foley-first audio.");
        for (const s of pics) if (!s.audio.sfx) bad(`shot ${s.n} has no sound effect.`, s.n);
        break;
      case "fade_before_card": {
        const i = sheet.shots.findIndex(isCard);
        const before = i > 0 ? sheet.shots[i - 1] : null;
        if (i < 0) bad("there is no end card.");
        else if (before && before.transition !== "fade_black") bad(`shot ${before.n} cuts into the end card; it must fade to black.`, before.n);
        break;
      }
      case "action_cuts": {
        const quick = pics.filter((s) => dur(s) <= 2.2).length;
        if (pics.length && quick / pics.length < 0.4) bad(`only ${quick} of ${pics.length} shots are 2 s or shorter; action beats should cut in 1–2 s.`);
        break;
      }
      case "reveal_holds":
        if (!pics.some((s) => dur(s) >= 3 && /wide|reveal|establish|full/i.test(`${s.shotType} ${s.framing}`))) bad("no wide reveal holds for 3 s or more.");
        break;
      case "macro_open": {
        const s = sheet.shots[0];
        if (s && !/macro|extreme close|ecu|detail/i.test(`${s.shotType} ${s.framing}`)) bad(`shot 1 is "${s.shotType}", not an extreme macro.`, 1);
        break;
      }
      case "diegetic_text":
        for (const s of pics) if (s.text && !/diegetic|in[- ]scene|on the (plate|label|object)/i.test(s.text.placement)) bad(`shot ${s.n} overlays "${s.text.copy}"; text belongs in the scene or on the end card.`, s.n);
        break;
    }
  }
  return out;
}

export function sheetGate(sheet: ShotSheet, o: { facts: string; rules?: StyleRule[] }): GateResult {
  const issues: GateIssue[] = timingIssues(sheet).map((text) => ({ level: "error" as const, text }));
  for (const s of sheet.shots) {
    if (!s.camera.move.trim() || !s.camera.angle.trim() || !(s.camera.lensMm > 0)) issues.push({ level: "error", shot: s.n, text: `Shot ${s.n} has no complete camera (angle, move and lens).` });
    if (!s.audio.vo && !s.audio.sfx && !s.audio.music) issues.push({ level: "error", shot: s.n, text: `Shot ${s.n} has no sound: give it a VO line, a sound effect or a music cue.` });
    if (sheet.audioMode === "foley" && s.audio.vo) issues.push({ level: "error", shot: s.n, text: `Shot ${s.n} has a VO line, but this sheet is foley-first.` });
    if (s.engine === "ai_video" && !s.prompt) issues.push({ level: "warn", shot: s.n, text: `Shot ${s.n} is AI video with no prompt; the row will be used as the prompt.` });
  }
  if (sheet.audioMode === "vo" && !sheet.shots.some((s) => s.audio.vo)) issues.push({ level: "error", text: "Voiceover mode, but no shot has a VO line." });
  issues.push(...ruleIssues(sheet, o.rules ?? sheet.rules), ...claimIssues(sheet, o.facts));
  return { pass: !issues.some((i) => i.level === "error"), issues, checkedAt: new Date().toISOString() };
}
