import { beforeEach, describe, expect, it, vi } from "vitest";

const chat = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/ai", async (original) => ({ ...await original<typeof import("@/lib/ai")>(), chatJSON: chat.fn }));

import { audioChecks, better, continuityScore, editChecks, researchGate, researchRules, shotRules, shotsGate, videoChecks } from "@/lib/stage-gates";
import { calibrated, combine, overrideStage, saveStage, scriptStage, stageBlock, stageScore, takeStageBlock, threshold } from "@/lib/stage-policy";
import { goldenSet, summarize } from "@/lib/judge-calibration";
import { SCRIPT_TARGET } from "@/lib/script-lab";
import type { Research, Shot, StudioRun } from "@/lib/types";

const usage = { costUsd: 0.001 };
const research: Research = { brand: "Lumen", summary: "UV bottle", audience: "Commuters", valueProps: ["UV-C cap", "Cold 24h", "USB-C"], tone: "Clean", angles: ["a", "b", "c", "d"], sources: ["https://a", "https://b"], competitors: [{ name: "LARQ" }, { name: "Hydro Flask" }] };
const voc = { phrases: ["smelly bottle"], pains: [], desires: [], objections: [], sources: ["https://r1", "https://r2"], sourcedQuotes: [{ text: "my bottle stinks", url: "https://r1" }] };
const shot = (id: string, visual: string, camera = "slow push-in", expectedVisual = ""): Shot => ({ id, beat: id, seconds: 3, visual, camera, vo: "Line", expectedVisual, status: "planned" });
const run = () => ({ stageScores: {} }) as unknown as StudioRun;

beforeEach(() => chat.fn.mockReset());

describe("stage policy", () => {
  it("weights checks and lets one broken dimension sink the stage", () => {
    expect(combine([{ name: "a", score: 10, note: "", by: "rules" }, { name: "b", score: 8, note: "", by: "rules", weight: 3 }])).toBe(8.5);
    expect(combine([{ name: "a", score: 10, note: "", by: "rules" }, { name: "b", score: 10, note: "", by: "rules" }, { name: "c", score: 2, note: "", by: "rules" }])).toBe(6);
  });

  it("script threshold matches the script lab and video uses the 9/10 bar", () => {
    expect(threshold("script")).toBe(SCRIPT_TARGET);
    expect(threshold("video")).toBe(9);
    expect(scriptStage(null)).toBeNull();
  });

  it("blocks under threshold until a human overrides, per direction", () => {
    const r = run();
    saveStage(r, stageScore("shots", [{ name: "x", score: 6, note: "", by: "rules" }], "rules", 1), "d1");
    expect(stageBlock(r, "shots", "d1")).toMatch(/Shot plan scored 6\/10 \(needs 8\)/);
    expect(stageBlock(r, "shots", "d2")).toBeNull();
    expect(overrideStage(r, "shots:d2", "me", "nope")).toBe(false);
    expect(overrideStage(r, "shots:d1", "me@x", "Good enough for a test")).toBe(true);
    expect(stageBlock(r, "shots", "d1")).toBeNull();
    expect(r.stageScores!["shots:d1"].override?.by).toBe("me@x");
  });

  it("blocks HD on a weak take stage unless that stage is overridden", () => {
    const r = run();
    const weak = stageScore("audio", [{ name: "loudness", score: 5, note: "", by: "rules" }], "rules", 1);
    expect(takeStageBlock(r, "d1", { stages: [weak] })).toMatch(/Sound & voice scored 5\/10 on this take/);
    saveStage(r, weak, "d1");
    overrideStage(r, "audio:d1", "me", "Music is intentionally quiet");
    expect(takeStageBlock(r, "d1", { stages: [weak] })).toBeNull();
  });

  it("calibration removes a judge's inflation and never adds points", () => {
    const cal = { id: "c", createdAt: "", costUsd: 0, disagreements: [], judges: [{ judge: "j", kind: "shots", accuracy: 0.5, inflation: 1.5, items: 2 }] };
    expect(calibrated(9, "j", cal, "shots")).toBe(7.5);
    expect(calibrated(9, "other", cal, "shots")).toBe(9);
    const s = stageScore("shots", [{ name: "judge", score: 9, note: "", by: "judge" }], "j", 1, [], cal);
    expect(s).toMatchObject({ score: 7.5, raw: 9, pass: false });
  });
});

describe("rule checks", () => {
  it("research: sources, depth, evidence and competitors", () => {
    const checks = researchRules(research, voc);
    expect(checks.map((c) => c.score)).toEqual([10, 10, 10, 10]);
    const thin = researchRules({ ...research, sources: ["https://a"], competitors: [] }, null);
    expect(thin.find((c) => c.name === "competitors")?.score).toBe(4);
    expect(thin.find((c) => c.name === "source coverage")?.score).toBe(4);
  });

  it("shots: vague, unframed, off-script shots score low; specific consistent ones high", () => {
    const vague = combine(shotRules([shot("a", "A bottle.", "", "Maya sniffs the bottle"), shot("b", "Logo.", "", "Maya presses the cap")]));
    const good = combine(shotRules([
      shot("a", "Close-up 50mm: Maya in a grey hoodie sniffs the old bottle in a white kitchen, winces, soft window light from the left side", "slow push-in", "Maya sniffs the bottle"),
      shot("b", "Medium shot 35mm: Maya in a grey hoodie presses the glowing cap of the black bottle in the white kitchen, soft window light", "static", "Maya presses the cap"),
    ]));
    expect(vague).toBeLessThan(6);
    expect(good).toBeGreaterThanOrEqual(8);
  });

  it("audio: WER, loudness near -14 LUFS, sync and music", () => {
    const ok = combine(audioChecks({ wer: 0, lufs: -14.2, peak: -1.6, linesOutside: 0, lines: 4, musicPlanned: true, musicPresent: true, speechFails: 0 }));
    const bad = combine(audioChecks({ wer: 0.3, lufs: -22, peak: -0.2, linesOutside: 2, lines: 4, musicPlanned: true, musicPresent: false, speechFails: 1 }));
    expect(ok).toBeGreaterThanOrEqual(9.5);
    expect(bad).toBeLessThan(5);
  });

  it("edit: unplanned cuts, off-beat shots and rushed lines are penalised", () => {
    const clean = combine(editChecks({ planned: [3, 6], detected: [3.05, 6.1], shotSeconds: [3, 3, 3], beatSeconds: [3, 3, 3], wordsPerShot: [6, 7, 6], continuity: 9 }));
    const messy = combine(editChecks({ planned: [3, 6], detected: [1.4, 3, 4.6, 6], shotSeconds: [3, 3, 3], beatSeconds: [2, 4, 3], wordsPerShot: [14, 6, 6], continuity: 5 }));
    expect(clean).toBeGreaterThanOrEqual(9);
    expect(messy).toBeLessThan(7);
  });

  it("continuity: computed from listed errors, not a free-form number", () => {
    expect(continuityScore([])).toBe(10);
    expect(continuityScore([{ severity: "minor" }])).toBe(8.5);
    expect(continuityScore([{ severity: "major" }, { severity: "minor" }])).toBe(4.5);
  });

  it("video: the worst scene drives the stage", () => {
    const s = combine(videoChecks([{ score: 9, notes: [], match: "pass" }, { score: 9, notes: [], match: "fail" }], 9));
    expect(s).toBeLessThan(9);
  });
});

describe("judged gates", () => {
  it("research gate flags hallucinated facts and hands back fixes", async () => {
    chat.fn.mockResolvedValue({ data: { grounded: 4, evidence: 7, competitors: 8, unsupported: ["FDA approved"], notes: ["Cite the 60-second claim"] }, usage });
    const g = await researchGate("judge", research, voc, "site text", null);
    expect(g.score.pass).toBe(false);
    expect(g.fixes[0]).toBe("Remove or source: FDA approved");
    expect(g.score.checks.find((c) => c.name === "no hallucinated facts")?.note).toMatch(/FDA approved/);
    expect(g.cost).toBe(0.001);
  });

  it("a broken judge verdict falls back to rule checks instead of blocking", async () => {
    chat.fn.mockResolvedValue({ data: { grounded: "high" }, usage });
    const g = await researchGate("judge", research, voc, "", null);
    expect(g.score.judge).toBe("rules");
    expect(g.score.pass).toBe(true);
    expect(g.fixes[0]).toMatch(/incomplete verdict/);
  });

  it("shots gate keeps the better attempt and counts the retry", async () => {
    chat.fn.mockResolvedValueOnce({ data: { specificity: 5, characters: 4, set: 5, lens: 5, continuity: 4, scriptMatch: 6, fixes: ["Shot 2: same hoodie"] }, usage });
    chat.fn.mockResolvedValueOnce({ data: { specificity: 9, characters: 9, set: 9, lens: 9, continuity: 9, scriptMatch: 9, fixes: [] }, usage });
    const shots = [shot("a", "Close-up 50mm: Maya in a grey hoodie sniffs the old bottle in a white kitchen, winces, soft window light", "push-in", "Maya sniffs the bottle")];
    const a = await shotsGate("judge", shots, null);
    expect(a.score.pass).toBe(false);
    expect(a.fixes).toContain("Shot 2: same hoodie");
    const b = await shotsGate("judge", shots, null, 2);
    const best = better(a, b);
    expect(best.score.score).toBe(b.score.score);
    expect(best.score.attempts).toBe(2);
    expect(best.cost).toBeCloseTo(0.002);
  });
});

describe("judge calibration", () => {
  it("golden set has one passing and one failing item per judge", () => {
    const items = goldenSet("j", "/tmp");
    for (const kind of ["research", "shots", "continuity"]) {
      expect(items.filter((i) => i.kind === kind).map((i) => i.label).sort()).toEqual(["fail", "pass"]);
    }
  });

  it("scores agreement, inflation on known-bad items and logs disagreements", () => {
    const r = summarize("j", [
      { kind: "research", item: "good", label: "pass", expected: 8.5, got: 9, note: "" },
      { kind: "research", item: "bad", label: "fail", expected: 3, got: 8.5, note: "missed FDA claim" },
      { kind: "continuity", item: "good", label: "pass", expected: 9, got: 9, note: "" },
      { kind: "continuity", item: "bad", label: "fail", expected: 3, got: 2, note: "" },
      { kind: "shots", item: "x", label: "pass", expected: 9, got: null, note: "error" },
    ]);
    expect(r.judges).toEqual([
      { judge: "j", kind: "research", accuracy: 0.5, inflation: 1.5, items: 2 },
      { judge: "j", kind: "edit", accuracy: 1, inflation: 0, items: 2 },
    ]);
    expect(r.disagreements).toEqual([{ kind: "research", item: "bad", label: "fail", expected: 3, got: 8.5, note: "missed FDA claim" }]);
  });
});
