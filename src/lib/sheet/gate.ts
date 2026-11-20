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
    const bad = (text: string, shot?: number) => out.push({ level: "warn", rule: r.id, shot, text: `Rule "${r.text}": ${text}` });
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
      case "reveal_holds": {
        // Parse threshold from rule text (e.g., "four full seconds" → 4)
        const thresholdMatch = r.text.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:full\s+)?(?:second|s\b)/i);
        const wordToNumber: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
        const threshold = thresholdMatch ? (wordToNumber[thresholdMatch[1].toLowerCase()] ?? Number(thresholdMatch[1])) : 3;
        // Accept wide, reveal, establishing, full, long shot, extreme wide, WS, EWS
        const isWideShot = (s: SheetShot) => /wide|reveal|establish|full|long\s+shot|extreme\s+wide|\bWS\b|\bEWS\b/i.test(`${s.shotType} ${s.framing}`);
        if (!pics.some((s) => dur(s) >= threshold && isWideShot(s))) bad(`no wide reveal holds for ${threshold} s or more.`);
        break;
      }
      case "macro_open": {
        const s = sheet.shots[0];
        if (s && !/macro|extreme close|ecu|detail/i.test(`${s.shotType} ${s.framing}`)) bad(`shot 1 is "${s.shotType}", not an extreme macro.`, 1);
        break;
      }
      // "diegetic_text" rule removed: text can be overlaid in brand style, not forced to be painted in scene
    }
  }
  return out;
}

/** Confession loop pattern checks (deterministic gates). These are always warnings, not blocking errors. */
export function confessionLoopChecks(sheet: ShotSheet): GateIssue[] {
  const issues: GateIssue[] = [];
  const pics = sheet.shots.filter((s) => !isCard(s));
  
  // Rule 4: "but…" beat with ~1s silence after
  const butBeat = pics.find((s) => s.beat === "but_silence");
  if (!butBeat) {
    issues.push({ level: "warn", text: 'Missing "but_silence" beat (rule 4: bring in the problem with "but…" and silence).' });
  } else {
    const hasVo = pics.some((s) => s.audio.vo);
    if (hasVo) {
      const butVo = (butBeat.audio.vo || "").toLowerCase();
      if (!butVo.includes("but")) {
        issues.push({ level: "warn", shot: butBeat.n, text: 'Beat "but_silence" must include "but" in the VO.' });
      }
    } else {
      // No VO: check for "but" in on-screen text or caption
      const butText = (butBeat.text?.copy || "").toLowerCase();
      if (!butText.includes("but")) {
        issues.push({ level: "warn", shot: butBeat.n, text: 'Beat "but_silence" must include "but" in on-screen text or caption (no VO).' });
      }
    }
    // Check for silence gap - this will be enforced in the stitcher, but we can check the beat structure
  }
  
  // Rule 9: setup cuts (goal, personal_stake, stake_raised, physical_example) should be 1.5–2s
  const setupBeats = ["goal", "personal_stake", "stake_raised", "physical_example"];
  for (const s of pics) {
    if (setupBeats.includes(s.beat || "")) {
      const d = dur(s);
      if (d < 1.5 || d > 2.0) {
        issues.push({ level: "warn", shot: s.n, text: `Setup beat "${s.beat}" is ${d.toFixed(1)}s; should be 1.5–2s (rule 9).` });
      }
    }
  }
  
  // Rule 10: long takes on low_point and crazy_plan (3+ seconds)
  const lowPoint = pics.find((s) => s.beat === "low_point");
  const crazyPlan = pics.find((s) => s.beat === "crazy_plan");
  
  if (!lowPoint) {
    issues.push({ level: "warn", text: 'Missing "low_point" beat (rule 10: hold one long take on the confession).' });
  } else if (dur(lowPoint) < 3) {
    issues.push({ level: "warn", shot: lowPoint.n, text: `Beat "low_point" is ${dur(lowPoint).toFixed(1)}s; needs 3+ seconds for the long take (rule 10).` });
  }
  
  if (!crazyPlan) {
    issues.push({ level: "warn", text: 'Missing "crazy_plan" beat (rule 10: hold one long take on the plan).' });
  } else if (dur(crazyPlan) < 3) {
    issues.push({ level: "warn", shot: crazyPlan.n, text: `Beat "crazy_plan" is ${dur(crazyPlan).toFixed(1)}s; needs 3+ seconds for the long take (rule 10).` });
  }
  
  // Rule 11: cutaway cadence (other shots) should be 2–3 seconds
  const otherBeats = ["owned_cause", "cut_before_attempt", "takeaway"];
  for (const s of pics) {
    if (otherBeats.includes(s.beat || "")) {
      const d = dur(s);
      if (d < 2 || d > 3) {
        issues.push({ level: "warn", shot: s.n, text: `Beat "${s.beat}" is ${d.toFixed(1)}s; cutaway cadence should be 2–3s (rule 11).` });
      }
    }
  }
  
  // Rule 12: captions 2–4 words per chunk, plus bright label in first 3s
  let hasBrightLabelEarly = false;
  for (const s of pics) {
    if (s.text?.chunks) {
      for (const chunk of s.text.chunks) {
        const words = chunk.trim().split(/\s+/).length;
        if (words < 2 || words > 4) {
          issues.push({ level: "warn", shot: s.n, text: `Caption chunk "${chunk}" has ${words} words; must be 2–4 words (rule 12).` });
        }
      }
    }
    // Check for bright label in first 3 seconds (expanded list)
    if (s.start < 3 && s.text?.copy && /\b(new|limited|exclusive|pro|max|ultra|premium|plus|advanced|elite|deluxe|signature|special|edition|now|introducing|best|top|super|mega|hyper)\b/i.test(s.text.copy)) {
      hasBrightLabelEarly = true;
    }
  }
  if (!hasBrightLabelEarly) {
    issues.push({ level: "warn", text: "No bright label found in the first 3 seconds (rule 12)." });
  }
  
  // Rule 13: VO pacing ~4 words per second (3.5–4.5 range, excluding slow beats)
  const slowBeats = ["but_silence", "low_point"];
  for (const s of pics) {
    if (s.audio.vo && !slowBeats.includes(s.beat || "")) {
      const words = s.audio.vo.trim().split(/\s+/).length;
      const d = dur(s);
      const wps = words / d;
      if (wps < 3.5 || wps > 4.5) {
        issues.push({ level: "warn", shot: s.n, text: `VO pacing is ${wps.toFixed(1)} words/sec; should be 3.5–4.5 (rule 13).` });
      }
    }
  }
  
  // Rule 14: no music
  if (sheet.bed && sheet.bed !== "null" && !sheet.bed.includes("no music")) {
    issues.push({ level: "warn", text: `Music bed is "${sheet.bed}"; rule 14 says no music.` });
  }
  for (const s of pics) {
    if (s.audio.music) {
      issues.push({ level: "warn", shot: s.n, text: `Shot ${s.n} has music cue "${s.audio.music}"; rule 14 says no music.` });
    }
  }
  
  // Rule 11+12: close-up at low point, then wide after
  if (lowPoint) {
    const isCU = /\b(CU|ECU|close)\b/i.test(lowPoint.shotType);
    if (!isCU) {
      issues.push({ level: "warn", shot: lowPoint.n, text: `Beat "low_point" should be a close-up (CU/ECU), not ${lowPoint.shotType} (rule 11).` });
    }
  }
  
  const takeaway = pics.find((s) => s.beat === "takeaway");
  if (takeaway) {
    const isWide = /\b(WS|MS|wide|medium)\b/i.test(takeaway.shotType);
    if (!isWide) {
      issues.push({ level: "warn", shot: takeaway.n, text: `Beat "takeaway" should go wide (WS/MS), not ${takeaway.shotType} (rule 11).` });
    }
  }
  
  // Rule 15: last VO echoes the first (60%+ token overlap)
  const voLines = pics.filter((s) => s.audio.vo).map((s) => s.audio.vo!);
  if (voLines.length >= 2) {
    const first = norm(voLines[0]);
    const last = norm(voLines[voLines.length - 1]);
    const firstTokens = first.split(/\s+/);
    const lastTokens = last.split(/\s+/);
    const overlap = firstTokens.filter((t) => lastTokens.includes(t)).length;
    const overlapPct = overlap / Math.max(firstTokens.length, lastTokens.length);
    if (overlapPct < 0.6) {
      issues.push({ level: "warn", text: `Last VO line doesn't echo the first (${Math.round(overlapPct * 100)}% overlap; needs 60%+, rule 15).` });
    }
  }
  
  // Rule 15: no CTA phrases (use word boundaries and context to avoid false positives like "tap water")
  const ctaPhrases = ["buy", "shop", "link in bio", "sign up", "learn more", "get yours", "order now", "try it", "download", "click"];
  const contextualCtaPhrases = [
    { pattern: /\btap\s+(to|the\s+link|here|now)\b/i, phrase: "tap to/tap the link" }
  ];
  
  for (const s of pics) {
    const allText = [s.audio.vo, s.text?.copy, s.action].filter(Boolean).join(" ").toLowerCase();
    
    // Check simple CTA phrases
    for (const phrase of ctaPhrases) {
      const regex = new RegExp(`\\b${phrase.replace(/\s+/g, "\\s+")}\\b`, "i");
      if (regex.test(allText)) {
        issues.push({ level: "warn", shot: s.n, text: `Shot ${s.n} contains CTA phrase "${phrase}"; rule 15 says no call to action.` });
      }
    }
    
    // Check contextual phrases like "tap to" but not "tap water"
    for (const { pattern, phrase } of contextualCtaPhrases) {
      if (pattern.test(allText)) {
        issues.push({ level: "warn", shot: s.n, text: `Shot ${s.n} contains CTA phrase "${phrase}"; rule 15 says no call to action.` });
      }
    }
  }
  
  // Rule 8+17: all beats present in order, attempt result never shown
  // Only check this if we're explicitly using the confession_loop pattern
  const expectedBeats = ["goal", "personal_stake", "stake_raised", "physical_example", "but_silence", "owned_cause", "low_point", "crazy_plan", "cut_before_attempt", "takeaway"];
  // Count end card for takeaway (it's excluded from pics)
  const allShots = sheet.shots.filter((s) => s.engine !== "remotion" || s.beat === "takeaway");
  const actualBeats = allShots.map((s) => s.beat).filter(Boolean);
  const missingBeats = expectedBeats.filter((b) => !actualBeats.includes(b));
  
  // Only warn about missing beats if pattern-specific beats were used (not for free-form sheets)
  if (missingBeats.length > 0 && actualBeats.length > 0) {
    issues.push({ level: "warn", text: `Missing beats: ${missingBeats.join(", ")} (rule 17: all beats must be present when using pattern beats).` });
  }
  
  // Check order (simplified: just check that beats appear in roughly the right sequence)
  let lastBeatIndex = -1;
  for (const s of pics) {
    if (s.beat) {
      const beatIndex = expectedBeats.indexOf(s.beat);
      if (beatIndex >= 0 && beatIndex < lastBeatIndex) {
        issues.push({ level: "warn", shot: s.n, text: `Beat "${s.beat}" appears out of order (rule 17).` });
      }
      lastBeatIndex = Math.max(lastBeatIndex, beatIndex);
    }
  }
  
  // Rule 8: check that no shot after "cut_before_attempt" shows a result/outcome
  const cutBeforeAttempt = pics.find((s) => s.beat === "cut_before_attempt");
  if (cutBeforeAttempt) {
    const afterCut = pics.filter((s) => s.n > cutBeforeAttempt.n);
    for (const s of afterCut) {
      if (/\b(result|success|works|done|complete|finish|achieve)\b/i.test(`${s.action} ${s.audio.vo || ""}`)) {
        issues.push({ level: "warn", shot: s.n, text: `Shot ${s.n} may show the result; rule 8 says cut before the attempt and never show the result.` });
      }
    }
  }
  
  return issues;
}

export function sheetGate(sheet: ShotSheet, o: { facts: string; rules?: StyleRule[]; afterRepair?: boolean; hasPhotos?: boolean }): GateResult {
  const issues: GateIssue[] = timingIssues(sheet).map((text) => ({ level: "error" as const, text }));
  const placeholderRegex = /\b(one physical example|insert product name|add brand here|placeholder|tbd|xxx|todo)\b/i;
  const isConfessionLoop = sheet.patternId === "confession_loop";
  
  // Check for product shot visibility
  const productShots = sheet.shots.filter((s) => 
    s.engine === "blender" && s.blender?.template === "product_hero" ||
    /\b(product|package|bottle|can|box|label)\b/i.test(`${s.subject} ${s.action}`)
  );
  
  if (o.hasPhotos === true && productShots.length === 0) {
    issues.push({ level: "error", text: "Product photos exist but there are no product shots. Add at least one clear product-hero beat." });
  }
  
  // Only warn about missing photos when product shots exist (sheet wants to show the product but has no photos)
  if (o.hasPhotos === false && productShots.length > 0) {
    issues.push({ level: "warn", text: "No product photos available. Research may have failed to scrape product images from the brand site." });
  }
  
  // Check for character consistency in people shots
  const peopleShots = sheet.shots.filter((s) => s.engine === "ai_video" && /\b(person|people|man|woman|hands|actor|character)\b/i.test(`${s.subject} ${s.prompt ?? ""}`));
  
  if (peopleShots.length > 0) {
    if (!sheet.character || !sheet.character.description) {
      issues.push({ level: "warn", text: `${peopleShots.length} people shot(s) but no recurring character defined. Different faces across shots may break continuity.` });
    } else {
      // Check that people shots reference the character
      const characterWords = new Set(sheet.character.description.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
      for (const s of peopleShots) {
        const shotText = `${s.subject} ${s.prompt ?? ""}`.toLowerCase();
        const matches = [...characterWords].filter((w) => shotText.includes(w));
        if (matches.length < 2) {
          issues.push({ level: "warn", shot: s.n, text: `Shot ${s.n} is a people shot but doesn't clearly reference the character ("${sheet.character.description.slice(0, 60)}").` });
        }
      }
    }
  }
  
  for (const s of sheet.shots) {
    if (!s.camera.move.trim() || !s.camera.angle.trim() || !(s.camera.lensMm > 0)) issues.push({ level: "error", shot: s.n, text: `Shot ${s.n} has no complete camera (angle, move and lens).` });
    if (!s.audio.vo && !s.audio.sfx && !s.audio.music) issues.push({ level: "error", shot: s.n, text: `Shot ${s.n} has no sound: give it a VO line, a sound effect or a music cue.` });
    if (sheet.audioMode === "foley" && s.audio.vo) issues.push({ level: "error", shot: s.n, text: `Shot ${s.n} has a VO line, but this sheet is foley-first.` });
    if (s.engine === "ai_video" && !s.prompt) issues.push({ level: "warn", shot: s.n, text: `Shot ${s.n} is AI video with no prompt; the row will be used as the prompt.` });
    if (s.blender?.template === "product_hero" && o.hasPhotos === false) issues.push({ level: "error", shot: s.n, text: `Shot ${s.n} uses product_hero template but no product photos are available.` });
    
    // Check for placeholder text
    const allText = [s.audio.vo, s.text?.copy, s.action, s.subject, s.blender?.word, s.blender?.label].filter(Boolean).join(" ");
    if (placeholderRegex.test(allText)) {
      issues.push({ level: "error", shot: s.n, text: `Shot ${s.n} contains placeholder text: "${allText.match(placeholderRegex)?.[0]}".` });
    }
  }
  if (sheet.audioMode === "vo" && !sheet.shots.some((s) => s.audio.vo)) issues.push({ level: "error", text: "Voiceover mode, but no shot has a VO line." });
  issues.push(...ruleIssues(sheet, o.rules ?? sheet.rules), ...claimIssues(sheet, o.facts));
  
  // Pattern-specific checks for confession_loop (always warnings, not blocking)
  // Only apply these checks when the user explicitly picked confession_loop
  if (isConfessionLoop) {
    issues.push(...confessionLoopChecks(sheet));
  }
  
  return { pass: !issues.some((i) => i.level === "error"), issues, checkedAt: new Date().toISOString() };
}
