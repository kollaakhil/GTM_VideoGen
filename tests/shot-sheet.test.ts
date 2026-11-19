import { describe, expect, it } from "vitest";
import { parseSheet, SheetSchema, type ShotSheet, type SheetShot } from "@/lib/shot-sheet";
import { fitTimings, setShotLength, tc, timingIssues, MIN_SHOT } from "@/lib/sheet/timing";
import { bannedPhrases, claimIssues, claimTokens, ruleIssues, sheetGate } from "@/lib/sheet/gate";
import { NEON_LAB_RULES, knownRules, cleanRules } from "@/lib/sheet/rules";
import { editorInstructions } from "@/lib/sheet/editor";

const FACTS = `- Name: Gemini 4 Neon.
- #1 overall on the Artificial Analysis Coding Agent Index (58.6).
- 1 million-token context window. $3 / $15 per million input/output tokens.
- Not verified, so don't use: "3x faster than Carbon", "60% lower cost" (press paraphrase only).`;

const shot = (n: number, start: number, end: number, o: Partial<SheetShot> = {}): SheetShot => ({
  id: `s${n}`, n, start, end, shotType: "ECU macro", framing: "engraved plate fills frame", camera: { angle: "eye level", move: "slow push-in 15%", lensMm: 100 },
  subject: "brass nameplate", action: "light slides across", lighting: "black void, cool rim", text: null, audio: { vo: null, sfx: "metal tick", music: null },
  transition: "cut", engine: "blender", engineLocked: false, editorNote: "", ...o,
});

const sheet = (shots: SheetShot[], o: Partial<ShotSheet> = {}): ShotSheet => SheetSchema.parse({
  version: 1, targetSec: 12, aspect: "16:9", fps: 24, audioMode: "foley", bed: "drone", palette: "", rules: [],
  endCard: { title: "Gemini 4 Neon", line: "Available in Google AI Studio", footer: "" }, shots, ...o,
});

const good = () => sheet([
  shot(1, 0, 1.5),
  shot(2, 1.5, 3, { shotType: "CU", subject: "brass switch", action: "switch snaps shut", audio: { vo: null, sfx: "switch snap at 0.3s", music: null } }),
  shot(3, 3, 7, { shotType: "WS reveal", framing: "wide reveal of the lit sign", subject: "neon sign", transition: "fade_black", blender: { template: "glow_word", word: "neon" } }),
  shot(4, 7, 12, { shotType: "end card", engine: "remotion", subject: "end card", text: { copy: "Gemini 4 Neon", placement: "centre" }, audio: { vo: null, sfx: null, music: "bed resolves" } }),
]);

describe("shot sheet schema", () => {
  it("parses a complete sheet and rejects a row with no camera", () => {
    expect(parseSheet(good()).ok).toBe(true);
    const bad = JSON.parse(JSON.stringify(good()));
    delete bad.shots[1].camera;
    const r = parseSheet(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/shots\.1\.camera/);
  });
  it("rejects unknown engines", () => {
    const bad = JSON.parse(JSON.stringify(good()));
    bad.shots[0].engine = "sora";
    expect(parseSheet(bad).ok).toBe(false);
  });
  it("clamps over-long framing to 240 characters ending with …", () => {
    const raw = JSON.parse(JSON.stringify(good()));
    raw.shots[0].framing = "A".repeat(400);
    const r = parseSheet(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sheet.shots[0].framing.length).toBeLessThanOrEqual(240);
      expect(r.sheet.shots[0].framing).toMatch(/…$/);
    }
  });
  it("clamps over-long framing at word boundary when possible", () => {
    const raw = JSON.parse(JSON.stringify(good()));
    raw.shots[0].framing = "The product sits on a table in the foreground with dramatic lighting coming from the left side and casting long shadows across " + "X".repeat(200);
    const r = parseSheet(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sheet.shots[0].framing.length).toBeLessThanOrEqual(240);
      expect(r.sheet.shots[0].framing).toMatch(/…$/);
      expect(r.sheet.shots[0].framing).not.toMatch(/X/);
    }
  });
  it("clamps over-long editorNote to 400 characters ending with …", () => {
    const raw = JSON.parse(JSON.stringify(good()));
    raw.shots[0].editorNote = "B".repeat(500);
    const r = parseSheet(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sheet.shots[0].editorNote.length).toBeLessThanOrEqual(400);
      expect(r.sheet.shots[0].editorNote).toMatch(/…$/);
    }
  });
  it("still rejects empty strings when min is 1", () => {
    const raw = JSON.parse(JSON.stringify(good()));
    raw.shots[0].id = "";
    const r1 = parseSheet(raw);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toMatch(/shots\.0\.id/);
    
    const raw2 = JSON.parse(JSON.stringify(good()));
    raw2.shots[0].shotType = "   ";
    const r2 = parseSheet(raw2);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toMatch(/shots\.0\.shotType/);
  });
  it("preserves default, optional, and nullable behavior", () => {
    const raw = JSON.parse(JSON.stringify(good()));
    delete raw.shots[0].framing;
    delete raw.shots[0].editorNote;
    const r = parseSheet(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sheet.shots[0].framing).toBe("");
      expect(r.sheet.shots[0].editorNote).toBe("");
    }
  });
});

describe("timing math", () => {
  it("fits sloppy model timings to the exact target, back to back", () => {
    const out = fitTimings([{ start: 0, end: 2 }, { start: 2.3, end: 3 }, { start: 3, end: 6.5 }], 12);
    expect(out[0].start).toBe(0);
    expect(out[2].end).toBe(12);
    for (let i = 1; i < out.length; i++) expect(out[i].start).toBe(out[i - 1].end);
    expect(timingIssues({ shots: out as SheetShot[], targetSec: 12 })).toEqual([]);
  });
  it("never makes a flash frame", () => {
    const out = fitTimings([{ start: 0, end: 0.05 }, { start: 0, end: 10 }, { start: 0, end: 10 }], 6);
    expect(out[0].end - out[0].start).toBeGreaterThanOrEqual(MIN_SHOT - 1e-9);
    expect(out[2].end).toBe(6);
  });
  it("flags gaps, overlaps and a wrong total", () => {
    const s = good();
    s.shots[2].start = 3.4;
    s.shots[3].end = 11;
    const issues = timingIssues(s);
    expect(issues.some((i) => /starts at 3.4s/.test(i))).toBe(true);
    expect(issues.some((i) => /target is 12s/.test(i))).toBe(true);
  });
  it("changing one shot's length keeps the total", () => {
    const s = setShotLength(good(), 0, 3);
    expect(s.shots[0].end - s.shots[0].start).toBeCloseTo(3, 1);
    expect(s.shots[s.shots.length - 1].end).toBe(12);
    expect(timingIssues(s)).toEqual([]);
  });
  it("formats timecodes", () => {
    expect(tc(3.4)).toBe("00:03.40");
    expect(tc(65.25)).toBe("01:05.25");
  });
});

describe("shot sheet gate (check 1 of 3)", () => {
  it("passes a clean sheet", () => {
    const g = sheetGate(good(), { facts: FACTS, rules: NEON_LAB_RULES.filter((r) => ["push_in", "fade_before_card", "foley_first", "diegetic_text"].includes(r.check ?? "")) });
    expect(g.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(g.pass).toBe(true);
  });
  it("blocks a beat with no sound and a VO line in a foley-first sheet", () => {
    const s = good();
    s.shots[0].audio = { vo: null, sfx: null, music: null };
    s.shots[1].audio = { vo: "Meet Neon.", sfx: "snap", music: null };
    const g = sheetGate(s, { facts: FACTS });
    expect(g.pass).toBe(false);
    expect(g.issues.map((i) => i.text).join("\n")).toMatch(/Shot 1 has no sound[\s\S]*Shot 2 has a VO line/);
  });
  it("blocks unverified claims and banned phrases, allows verified ones", () => {
    expect(bannedPhrases(FACTS)).toEqual(["3x faster than carbon", "60% lower cost"]);
    expect(claimTokens("1M tokens for $3")).toEqual(expect.arrayContaining(["1million", "$3"]));
    const s = good();
    s.shots[0].blender = { template: "macro_label", label: "NE 10 · 1M TOKENS" };
    s.shots[2].text = { copy: "#1 coding agent", placement: "diegetic on the plate" };
    expect(claimIssues(s, FACTS)).toEqual([]);
    s.shots[2].text = { copy: "3x faster than Carbon", placement: "diegetic" };
    s.endCard.footer = "Now 2 million tokens, the fastest model";
    const t = claimIssues(s, FACTS).map((i) => i.text).join("\n");
    expect(t).toMatch(/unverified/);
    expect(t).toMatch(/"2million"/);
    expect(t).toMatch(/fastest/);
  });
  it("enforces machine-checkable style rules", () => {
    const s = good();
    s.shots[1].camera.move = "static";
    s.shots[2].transition = "cut";
    s.shots[0].shotType = "WS";
    s.shots[1].text = { copy: "Switch on", placement: "lower third" };
    const t = ruleIssues(s, NEON_LAB_RULES).map((i) => i.text).join("\n");
    expect(t).toMatch(/shot 2 moves "static"/);
    expect(t).toMatch(/fade to black/);
    expect(t).toMatch(/not an extreme macro/);
    expect(t).toMatch(/overlays "Switch on"/);
  });
});

describe("style rules and editor instructions", () => {
  it("knows the Neon reference and cleans model rules", () => {
    expect(knownRules("https://x.com/sundarpichai/status/2123184309137965524?s=19")?.rules).toHaveLength(15);
    expect(knownRules("https://example.com")).toBeNull();
    expect(cleanRules([{ text: " Slow push-in ", check: "push_in" }, { text: "Warm light", check: "nope" }, { text: "" }])).toEqual([{ id: "r1", text: "Slow push-in", check: "push_in" }, { id: "r2", text: "Warm light" }]);
  });
  it("writes one timed instruction block per shot", () => {
    const t = editorInstructions(good());
    expect(t).toMatch(/00:00\.00–00:01\.50  #1  ECU macro  \[Blender 3D\]/);
    expect(t).toMatch(/Out: fade to black/);
    expect(t).toMatch(/End card: Gemini 4 Neon/);
  });
});
