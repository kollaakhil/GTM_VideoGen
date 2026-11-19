import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATA_DIR = require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "sheet-flow-"));
});

import { normaliseSheet, sheetPrompt, writeSheet, type Chat } from "@/lib/sheet/writer";
import { applySheetEdit, newSheetRun, runSheet } from "@/lib/sheet/flow";
import { meterFor } from "@/lib/sheet/jobs";
import { NEON_LAB_RULES } from "@/lib/sheet/rules";
import { timingIssues } from "@/lib/sheet/timing";

const FACTS = "- Gemini 4 Neon.\n- 1 million-token context window.\n- Available in Google AI Studio.";

/** What a model really sends back: sloppy timings, missing fields, a VO line in a foley sheet, nulls. */
const messy = (o: { claim?: string } = {}) => ({
  bed: "low synth drone",
  endCard: { title: "Gemini 4 Neon", line: "Available in Google AI Studio", footer: "" },
  shots: [
    { start: 0, end: 1.2, shotType: "ECU macro", framing: "engraved plate", camera: { angle: "eye level", move: "slow push-in 15%", lensMm: 100 }, subject: "brass nameplate", action: "light slides", lighting: "black void", text: null, audio: { vo: "Meet Neon.", sfx: "metal tick", music: null }, transition: "cut", engine: "blender", blender: { template: "macro_label", label: o.claim ?? "NE 10 · 1M TOKENS", color: null } },
    { start: 1.4, end: 3, shotType: "CU", framing: "brass switch", camera: { move: "slow push-in" }, subject: "switch", action: "snaps", audio: { sfx: "switch snap" }, engine: "blender" },
    { start: 3, end: 8, shotType: "WS reveal", framing: "wide reveal", camera: { angle: "eye", move: "slow push-in 10%", lensMm: 50 }, subject: "neon sign", action: "glows", audio: { sfx: "hum" }, transition: "fade_black", engine: "nonsense" },
    { start: 8, end: 9, shotType: "end card", subject: "end card", camera: { angle: "flat", move: "static", lensMm: 50 }, audio: { music: "bed resolves" }, engine: "blender" },
  ],
});

const input = { brand: "Gemini 4 Neon", goal: "Launch film", facts: FACTS, brief: null, research: null, rules: NEON_LAB_RULES, targetSec: 12, aspect: "16:9" as const, audioMode: "foley" as const, hasPhotos: false };

describe("script enhancer → shot sheet", () => {
  it("normalises a messy model sheet into a valid, exactly-timed sheet", () => {
    const s = normaliseSheet(messy(), input);
    expect(s.shots.map((x) => x.id)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(timingIssues(s)).toEqual([]);
    expect(s.shots[0].audio.vo).toBeNull(); // foley-first: VO is dropped
    expect(s.shots[1].camera).toEqual({ angle: "eye level", move: "slow push-in", lensMm: 50 });
    expect(s.shots[2].engine).toBe("blender");
    expect(s.shots[3].engine).toBe("remotion");
    expect(s.shots[0].blender).toEqual({ template: "macro_label", label: "NE 10 · 1M TOKENS" });
  });
  it("puts facts, rules, audio mode and fixes in the prompt", () => {
    const p = sheetPrompt(input, [{ level: "error", text: "Shot 2 has no sound" }]);
    expect(p).toMatch(/VERIFIED FACTS[\s\S]*1 million-token/);
    expect(p).toMatch(/\[r1\] Every shot is a slow continuous push-in/);
    expect(p).toMatch(/FOLEY-FIRST/);
    expect(p).toMatch(/FIX THESE PROBLEMS[\s\S]*Shot 2 has no sound/);
  });
  it("writeSheet uses the injected model and reports its cost", async () => {
    const chat: Chat = async <T,>() => ({ data: { script: "Light. Switch. Neon." , sheet: messy() } as T, usd: 0.0012 });
    const out = await writeSheet(input, chat);
    expect(out.usd).toBe(0.0012);
    expect(out.script).toBe("Light. Switch. Neon.");
  });
});

describe("sheet step", () => {
  const run = () => {
    const r = newSheetRun({ brandUrl: "https://blog.google", brand: "Gemini 4 Neon", goal: "Launch film", facts: FACTS, targetSec: 12, inspirationUrl: "https://x.com/sundarpichai/status/2123184309137965524" }, "t@x");
    r.brief = { objective: "o", audience: "a", insight: "i", offer: "", mandatories: [], kpi: "k" };
    r.rules = [{ id: "r1", text: "Foley first", check: "foley_first" }];
    return r;
  };
  it("repairs once with the gate's errors when the first sheet makes an unverified claim", async () => {
    const r = run();
    const prompts: string[] = [];
    const chat: Chat = async <T,>(_s: string, u: string) => {
      prompts.push(u);
      return { data: { script: "x", sheet: messy({ claim: prompts.length === 1 ? "3 MILLION TOKENS" : "1M TOKENS" }) } as T, usd: 0.001 };
    };
    await runSheet(r, chat);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toMatch(/FIX THESE PROBLEMS[\s\S]*3million/);
    expect(r.gate?.pass).toBe(true);
    expect(r.step).toBe("sheet");
    expect(r.timings.map((t) => t.stage)).toEqual(["shot sheet", "shot sheet repair"]);
  });
  it("operator edits are validated, refit to the target and re-gated", async () => {
    const r = run();
    const chat: Chat = async <T,>() => ({ data: { script: "x", sheet: messy() } as T, usd: 0 });
    await runSheet(r, chat);
    const edit = structuredClone(r.sheet!);
    edit.shots[1].end = edit.shots[1].start + 4; // longer shot: the rest refits
    edit.shots[1].audio = { vo: null, sfx: null, music: null };
    expect(applySheetEdit(r, edit)).toEqual({ ok: true });
    expect(r.sheet!.version).toBe(2);
    expect(timingIssues(r.sheet!)).toEqual([]);
    expect(r.gate!.pass).toBe(false);
    expect(r.gate!.issues.some((i) => /Shot 2 has no sound/.test(i.text))).toBe(true);
    expect(applySheetEdit(r, { nope: 1 })).toHaveProperty("error");
  });
  it("text calls are refused past the run cap and logged under it", async () => {
    const r = run();
    r.cost.capUsd = 0.03;
    const m = meterFor(r);
    await m.run({ stage: "sheet", what: "a", model: "m", estimate: 0.02 }, async () => ({ value: 1, usd: 0.015 }));
    expect(r.cost.spentUsd).toBe(0.015);
    await expect(m.run({ stage: "sheet", what: "b", model: "m", estimate: 0.02 }, async () => ({ value: 1 }))).rejects.toThrow(/Run cap reached/);
    expect(r.cost.entries).toHaveLength(1);
  });
});

describe("spend ledger", () => {
  it("appends app calls with the ledger's running total", async () => {
    const fs = await import("node:fs");
    const { ledger, ledgerTotal } = await import("@/lib/sheet/jobs");
    const file = `${process.env.DATA_DIR}/ledger.md`;
    fs.writeFileSync(file, "| when | run | what | cost | total | note |\n|---|---|---|---|---|---|\n| 2026-11-19 09:43 | x | judge | $0.2315 | $13.6393 |  |\n");
    process.env.SPEND_LEDGER = file;
    const r = newSheetRun({ brandUrl: "https://a.com", goal: "goal" }, "t");
    ledger(r, { at: new Date().toISOString(), stage: "sheet", what: "call", model: "m", usd: 0.0285, estimate: 0.02 });
    delete process.env.SPEND_LEDGER;
    expect(ledgerTotal(file)).toBeCloseTo(13.6678, 4);
  });
});
