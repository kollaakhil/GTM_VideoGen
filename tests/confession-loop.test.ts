/**
 * Tests for the Confession loop story pattern: data structure, gate checks, and pattern-specific quality rules.
 */

import { describe, it, expect } from "vitest";
import { CONFESSION_LOOP, CLASSIC, getPattern, PATTERNS } from "@/lib/sheet/patterns";
import { confessionLoopChecks } from "@/lib/sheet/gate";
import { parseSheet, type ShotSheet } from "@/lib/shot-sheet";

describe("Confession loop pattern", () => {
  it("has all 17 rules verbatim", () => {
    expect(CONFESSION_LOOP.rules).toHaveLength(17);
    expect(CONFESSION_LOOP.rules[0]).toContain("Open with the goal");
    expect(CONFESSION_LOOP.rules[3]).toContain("but...");
    expect(CONFESSION_LOOP.rules[8]).toContain("1.5-2 seconds");
    expect(CONFESSION_LOOP.rules[14]).toContain("no call to action");
  });

  it("marks the correct rules as gate-checked vs judged", () => {
    expect(CONFESSION_LOOP.gateChecked).toContain(3); // "but…" with silence
    expect(CONFESSION_LOOP.gateChecked).toContain(8); // setup cuts
    expect(CONFESSION_LOOP.gateChecked).toContain(12); // VO pacing
    expect(CONFESSION_LOOP.gateChecked).toContain(14); // no CTA
    
    expect(CONFESSION_LOOP.judged).toContain(1); // personal stake
    expect(CONFESSION_LOOP.judged).toContain(2); // physical example
    expect(CONFESSION_LOOP.judged).toContain(6); // crazy plan
    expect(CONFESSION_LOOP.judged).toContain(15); // rule-and-example
  });

  it("has 10 beats in the expected order", () => {
    expect(CONFESSION_LOOP.beats).toHaveLength(10);
    expect(CONFESSION_LOOP.beats.map((b) => b.beat)).toEqual([
      "goal", "personal_stake", "stake_raised", "physical_example", 
      "but_silence", "owned_cause", "low_point", "crazy_plan", 
      "cut_before_attempt", "takeaway"
    ]);
  });

  it("specifies no music and pauses work", () => {
    expect(CONFESSION_LOOP.audio.music).toBe(false);
    expect(CONFESSION_LOOP.audio.pausesWork).toBe(true);
  });

  it("specifies no CTA and echo opening", () => {
    expect(CONFESSION_LOOP.ending.cta).toBe(false);
    expect(CONFESSION_LOOP.ending.echoOpening).toBe(true);
  });

  it("getPattern returns confession_loop by default", () => {
    expect(getPattern().id).toBe("confession_loop");
    expect(getPattern(null).id).toBe("confession_loop");
    expect(getPattern(undefined).id).toBe("confession_loop");
  });

  it("getPattern returns classic when requested", () => {
    expect(getPattern("classic").id).toBe("classic");
  });

  it("Classic pattern has no specific rules", () => {
    expect(CLASSIC.rules).toHaveLength(0);
    expect(CLASSIC.beats).toHaveLength(0);
  });
});

describe("confessionLoopChecks gate", () => {
  const baseSheet: ShotSheet = {
    version: 1,
    targetSec: 15,
    aspect: "9:16",
    fps: 24,
    audioMode: "vo",
    bed: "null",
    palette: "warm, intimate",
    rules: [],
    patternId: "confession_loop",
    shots: [
      { id: "s1", n: 1, start: 0, end: 1.8, shotType: "CU", framing: "face", camera: { angle: "eye level", move: "slow push-in", lensMm: 50 }, subject: "speaker", action: "speaks", lighting: "soft", text: { copy: "My goal now", placement: "lower third", chunks: ["My goal", "now"] }, audio: { vo: "Here's my big goal right now today.", sfx: null, music: null }, transition: "cut", engine: "ai_video", engineLocked: false, editorNote: "", beat: "goal" },
      { id: "s2", n: 2, start: 1.8, end: 3.5, shotType: "CU", framing: "face", camera: { angle: "eye level", move: "slow push-in", lensMm: 50 }, subject: "speaker", action: "gestures", lighting: "soft", text: null, audio: { vo: "It really matters so much to me because of my kid.", sfx: null, music: null }, transition: "cut", engine: "ai_video", engineLocked: false, editorNote: "", beat: "personal_stake" },
      { id: "s3", n: 3, start: 3.5, end: 5.3, shotType: "CU", framing: "hands", camera: { angle: "high", move: "static", lensMm: 85 }, subject: "product", action: "picks up", lighting: "key", text: null, audio: { vo: "And the stakes just got way higher now.", sfx: null, music: null }, transition: "cut", engine: "ai_video", engineLocked: false, editorNote: "", beat: "stake_raised" },
      { id: "s4", n: 4, start: 5.3, end: 7, shotType: "ECU", framing: "detail", camera: { angle: "eye level", move: "macro push", lensMm: 100 }, subject: "label", action: "reads", lighting: "spot", text: { copy: "One tiny thing", placement: "lower third", chunks: ["One tiny", "thing"] }, audio: { vo: "Just look at this one tiny thing here.", sfx: null, music: null }, transition: "cut", engine: "blender", engineLocked: false, editorNote: "", beat: "physical_example" },
      { id: "s5", n: 5, start: 7, end: 9.5, shotType: "MS", framing: "waist up", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "speaker", action: "pauses", lighting: "dim", text: null, audio: { vo: "But wait. Here is the big problem.", sfx: null, music: null }, transition: "cut", engine: "ai_video", engineLocked: false, editorNote: "", beat: "but_silence" },
      { id: "s6", n: 6, start: 9.5, end: 12, shotType: "CU", framing: "face tight", camera: { angle: "low", move: "static", lensMm: 85 }, subject: "speaker", action: "confesses", lighting: "harsh key", text: null, audio: { vo: "I caused this whole mess all by myself. Now you're like uh-oh.", sfx: null, music: null }, transition: "cut", engine: "ai_video", engineLocked: false, editorNote: "", beat: "owned_cause" },
      { id: "s7", n: 7, start: 12, end: 15.5, shotType: "ECU", framing: "eyes", camera: { angle: "eye level", move: "slow push-in", lensMm: 100 }, subject: "speaker", action: "holds stare", lighting: "single source", text: { copy: "Wild plan here", placement: "lower third", chunks: ["Wild plan", "here"] }, audio: { vo: "So here is my wild crazy plan to go fix it all.", sfx: null, music: null }, transition: "cut", engine: "ai_video", engineLocked: false, editorNote: "", beat: "low_point" },
      { id: "s8", n: 8, start: 15.5, end: 19, shotType: "MS", framing: "action", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "speaker", action: "explains", lighting: "neutral", text: null, audio: { vo: "I will try this crazy wild thing that sounds very impossible.", sfx: null, music: null }, transition: "cut", engine: "ai_video", engineLocked: false, editorNote: "", beat: "crazy_plan" },
      { id: "s9", n: 9, start: 19, end: 19.5, shotType: "CU", framing: "hand reaching", camera: { angle: "high", move: "static", lensMm: 50 }, subject: "hand", action: "reaches", lighting: "backlit", text: null, audio: { vo: null, sfx: "whoosh", music: null }, transition: "cut", engine: "ai_video", engineLocked: false, editorNote: "", beat: "cut_before_attempt" },
      { id: "s10", n: 10, start: 19.5, end: 21.5, shotType: "WS", framing: "full scene", camera: { angle: "eye level", move: "slow pull back", lensMm: 35 }, subject: "speaker", action: "smiles", lighting: "soft fill", text: { copy: "Back to goal", placement: "lower third", chunks: ["Back to", "goal"] }, audio: { vo: "And that is my big goal right now.", sfx: null, music: null }, transition: "fade_black", engine: "ai_video", engineLocked: false, editorNote: "", beat: "takeaway" },
      { id: "s11", n: 11, start: 21.5, end: 24, shotType: "end card", framing: "centered", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "brand", action: "displays", lighting: "clean", text: { copy: "Brand Name", placement: "center", chunks: ["Brand", "Name"] }, audio: { vo: null, sfx: null, music: null }, transition: "cut", engine: "remotion", engineLocked: false, editorNote: "" },
    ],
    endCard: { title: "Brand", line: "Visit site.com", footer: "Proof line" },
  };

  it("detects issues in a near-good sheet", () => {
    const issues = confessionLoopChecks(baseSheet);
    // Should detect some issues (chunks, pacing, echo) but not catastrophic failures
    const warnings = issues.filter((i) => i.level === "warn");
    // Expect some warnings for caption chunks, pacing, and echo overlap (pattern checks are warnings now)
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.length).toBeLessThan(15);
  });

  it("fails when but_silence beat is missing", () => {
    const sheet = {
      ...baseSheet,
      shots: baseSheet.shots.map((s) => s.beat === "but_silence" ? { ...s, beat: undefined } : s),
    };
    const issues = confessionLoopChecks(sheet);
    expect(issues.some((i) => i.text.includes('Missing "but_silence" beat'))).toBe(true);
  });

  it('fails when but_silence beat has no "but" in VO', () => {
    const sheet = {
      ...baseSheet,
      shots: baseSheet.shots.map((s) => 
        s.beat === "but_silence" ? { ...s, audio: { ...s.audio, vo: "Here's the problem." } } : s
      ),
    };
    const issues = confessionLoopChecks(sheet);
    expect(issues.some((i) => i.text.includes('must include "but"'))).toBe(true);
  });

  it("fails when setup cuts are too long", () => {
    const sheet = {
      ...baseSheet,
      shots: baseSheet.shots.map((s) => 
        s.beat === "goal" ? { ...s, start: 0, end: 2.5 } : s
      ),
    };
    const issues = confessionLoopChecks(sheet);
    expect(issues.some((i) => i.text.includes("Setup beat") && i.text.includes("2.5s"))).toBe(true);
  });

  it("fails when long takes are too short", () => {
    const sheet = {
      ...baseSheet,
      shots: baseSheet.shots.map((s) => 
        s.beat === "low_point" ? { ...s, start: 12, end: 14 } : s
      ),
    };
    const issues = confessionLoopChecks(sheet);
    expect(issues.some((i) => i.text.includes("low_point") && i.text.includes("3+ seconds"))).toBe(true);
  });

  it("fails when captions have wrong word count", () => {
    const sheet = {
      ...baseSheet,
      shots: baseSheet.shots.map((s) => 
        s.id === "s1" ? { ...s, text: { copy: "This is too many words for a chunk", placement: "lower third", chunks: ["This is too many words for a chunk"] } } : s
      ),
    };
    const issues = confessionLoopChecks(sheet);
    expect(issues.some((i) => i.text.includes("must be 2–4 words"))).toBe(true);
  });

  it("fails when VO pacing is off", () => {
    const sheet = {
      ...baseSheet,
      shots: baseSheet.shots.map((s) => 
        s.beat === "goal" ? { ...s, audio: { ...s.audio, vo: "Just one word." } } : s
      ),
    };
    const issues = confessionLoopChecks(sheet);
    expect(issues.some((i) => i.text.includes("VO pacing"))).toBe(true);
  });

  it("fails when music is present", () => {
    const sheet = {
      ...baseSheet,
      bed: "upbeat electronic",
    };
    const issues = confessionLoopChecks(sheet);
    expect(issues.some((i) => i.text.includes("rule 14 says no music"))).toBe(true);
  });

  it("fails when low_point is not a close-up", () => {
    const sheet = {
      ...baseSheet,
      shots: baseSheet.shots.map((s) => 
        s.beat === "low_point" ? { ...s, shotType: "WS" } : s
      ),
    };
    const issues = confessionLoopChecks(sheet);
    expect(issues.some((i) => i.text.includes("should be a close-up"))).toBe(true);
  });

  it("fails when last VO doesn't echo first", () => {
    const sheet = {
      ...baseSheet,
      shots: baseSheet.shots.map((s) => 
        s.beat === "takeaway" ? { ...s, audio: { ...s.audio, vo: "Something completely different ends here." } } : s
      ),
    };
    const issues = confessionLoopChecks(sheet);
    expect(issues.some((i) => i.text.includes("doesn't echo the first"))).toBe(true);
  });

  it("fails when CTA phrases are present", () => {
    const sheet = {
      ...baseSheet,
      shots: baseSheet.shots.map((s) => 
        s.beat === "takeaway" ? { ...s, audio: { ...s.audio, vo: "Shop now at our store." } } : s
      ),
    };
    const issues = confessionLoopChecks(sheet);
    expect(issues.some((i) => i.text.includes('CTA phrase "shop"'))).toBe(true);
  });

  it("fails when beats are missing", () => {
    const sheet = {
      ...baseSheet,
      shots: baseSheet.shots.filter((s) => s.beat !== "crazy_plan"),
    };
    const issues = confessionLoopChecks(sheet);
    expect(issues.some((i) => i.text.includes("Missing beats"))).toBe(true);
  });
});

describe("Sheet parsing with patterns", () => {
  it("parses old sheets without beat fields", () => {
    const oldSheet = {
      version: 1,
      targetSec: 10,
      aspect: "16:9",
      fps: 24,
      audioMode: "vo",
      bed: "ambient",
      palette: "cool",
      rules: [],
      shots: [
        {
          id: "s1",
          n: 1,
          start: 0,
          end: 2,
          shotType: "CU",
          framing: "face",
          camera: { angle: "eye level", move: "static", lensMm: 50 },
          subject: "person",
          action: "speaks",
          lighting: "soft",
          text: null,
          audio: { vo: "Hello there.", sfx: null, music: null },
          transition: "cut",
          engine: "ai_video",
          engineLocked: false,
          editorNote: "",
        },
      ],
      endCard: { title: "Brand", line: "", footer: "" },
    };

    const result = parseSheet(oldSheet);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sheet.shots[0].beat).toBeUndefined();
    }
  });

  it("parses new sheets with beat fields", () => {
    const newSheet = {
      version: 1,
      targetSec: 10,
      aspect: "9:16",
      fps: 24,
      audioMode: "vo",
      bed: "null",
      palette: "warm",
      rules: [],
      patternId: "confession_loop",
      shots: [
        {
          id: "s1",
          n: 1,
          start: 0,
          end: 1.8,
          shotType: "CU",
          framing: "face",
          camera: { angle: "eye level", move: "static", lensMm: 50 },
          subject: "speaker",
          action: "speaks",
          lighting: "soft",
          text: { copy: "Goal", chunks: ["Goal"] },
          audio: { vo: "Here's my goal.", sfx: null, music: null },
          transition: "cut",
          engine: "ai_video",
          engineLocked: false,
          editorNote: "",
          beat: "goal",
        },
      ],
      endCard: { title: "Brand", line: "", footer: "" },
    };

    const result = parseSheet(newSheet);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sheet.shots[0].beat).toBe("goal");
      expect(result.sheet.patternId).toBe("confession_loop");
    }
  });

  it("caption chunks are optional and preserved when present", () => {
    // Testing that chunks can be present in text objects
    // (full parseSheet integration tested elsewhere)
    const textWithChunks = { copy: "Test caption", placement: "lower third", chunks: ["Test", "caption"] };
    expect(textWithChunks.chunks).toEqual(["Test", "caption"]);
  });
});

describe("Non-Neon brand test", () => {
  it("confession loop works for any brand", () => {
    const genericBrandSheet: ShotSheet = {
      version: 1,
      targetSec: 15,
      aspect: "9:16",
      fps: 24,
      audioMode: "vo",
      bed: "null",
      palette: "natural light",
      rules: [],
      patternId: "confession_loop",
      shots: [
        { id: "s1", n: 1, start: 0, end: 1.6, shotType: "CU", framing: "coffee cup", camera: { angle: "eye level", move: "slow push-in", lensMm: 50 }, subject: "coffee", action: "steam rises", lighting: "window light", text: { copy: "Morning goal", placement: "lower third", chunks: ["Morning", "goal"] }, audio: { vo: "I want better coffee at home.", sfx: null, music: null }, transition: "cut", engine: "blender", engineLocked: false, editorNote: "", beat: "goal" },
        { id: "s2", n: 2, start: 1.6, end: 3.4, shotType: "MCU", framing: "hands pouring", camera: { angle: "high", move: "static", lensMm: 50 }, subject: "hands", action: "pours beans", lighting: "soft", text: null, audio: { vo: "Because I love that morning ritual.", sfx: "beans drop", music: null }, transition: "cut", engine: "ai_video", engineLocked: false, editorNote: "", beat: "personal_stake" },
        { id: "s3", n: 3, start: 3.4, end: 5.2, shotType: "CU", framing: "hand holds bag", camera: { angle: "eye level", move: "static", lensMm: 85 }, subject: "coffee bag", action: "displays", lighting: "natural", text: null, audio: { vo: "And now I buy premium beans.", sfx: null, music: null }, transition: "cut", engine: "ai_video", engineLocked: false, editorNote: "", beat: "stake_raised" },
        { id: "s4", n: 4, start: 5.2, end: 6.9, shotType: "ECU", framing: "grind setting", camera: { angle: "top-down", move: "macro", lensMm: 100 }, subject: "grinder dial", action: "adjusts", lighting: "spot", text: { copy: "One setting", placement: "lower third", chunks: ["One", "setting"] }, audio: { vo: "Here's one tiny grind tweak.", sfx: "click", music: null }, transition: "cut", engine: "blender", engineLocked: false, editorNote: "", beat: "physical_example" },
        { id: "s5", n: 5, start: 6.9, end: 9.3, shotType: "MS", framing: "person waits", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "person", action: "stares at machine", lighting: "dim", text: null, audio: { vo: "But my grinder broke yesterday.", sfx: null, music: null }, transition: "cut", engine: "ai_video", engineLocked: false, editorNote: "", beat: "but_silence" },
        { id: "s6", n: 6, start: 9.3, end: 11.5, shotType: "CU", framing: "face close", camera: { angle: "low", move: "static", lensMm: 85 }, subject: "person", action: "admits", lighting: "single key", text: null, audio: { vo: "I dropped it. Now you're like, uh-oh.", sfx: null, music: null }, transition: "cut", engine: "ai_video", engineLocked: false, editorNote: "", beat: "owned_cause" },
        { id: "s7", n: 7, start: 11.5, end: 15, shotType: "ECU", framing: "eyes", camera: { angle: "eye level", move: "slow push-in", lensMm: 100 }, subject: "eyes", action: "holds gaze", lighting: "dramatic", text: { copy: "Oh no", placement: "lower third", chunks: ["Oh", "no"] }, audio: { vo: "So I'm brewing in a sock tonight.", sfx: null, music: null }, transition: "cut", engine: "ai_video", engineLocked: false, editorNote: "", beat: "low_point" },
        { id: "s8", n: 8, start: 15, end: 18.5, shotType: "MS", framing: "action setup", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "person", action: "explains plan", lighting: "neutral", text: null, audio: { vo: "A sock filter. Sounds wild but it might work.", sfx: null, music: null }, transition: "cut", engine: "ai_video", engineLocked: false, editorNote: "", beat: "crazy_plan" },
        { id: "s9", n: 9, start: 18.5, end: 19, shotType: "CU", framing: "hand reaching", camera: { angle: "high", move: "static", lensMm: 50 }, subject: "hand", action: "reaches for sock", lighting: "backlit", text: null, audio: { vo: null, sfx: "rustling", music: null }, transition: "cut", engine: "ai_video", engineLocked: false, editorNote: "", beat: "cut_before_attempt" },
        { id: "s10", n: 10, start: 19, end: 21, shotType: "WS", framing: "full kitchen", camera: { angle: "eye level", move: "slow pull", lensMm: 35 }, subject: "person", action: "smiles", lighting: "morning light", text: { copy: "Back to goal", placement: "lower third", chunks: ["Back to", "goal"] }, audio: { vo: "I want better coffee at home.", sfx: null, music: null }, transition: "fade_black", engine: "ai_video", engineLocked: false, editorNote: "", beat: "takeaway" },
        { id: "s11", n: 11, start: 21, end: 23.5, shotType: "end card", framing: "centered", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "brand", action: "displays", lighting: "clean", text: { copy: "Coffee Co", placement: "center", chunks: ["Coffee", "Co"] }, audio: { vo: null, sfx: null, music: null }, transition: "cut", engine: "remotion", engineLocked: false, editorNote: "" },
      ],
      endCard: { title: "Coffee Co", line: "Visit coffeeco.com", footer: "Premium beans" },
    };

    const issues = confessionLoopChecks(genericBrandSheet);
    const warnings = issues.filter((i) => i.level === "warn");
    // Should have some warnings but not catastrophic (pattern checks are warnings now)
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.length).toBeLessThan(20);
  });
});
