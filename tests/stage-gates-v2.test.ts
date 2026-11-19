import { beforeEach, describe, expect, it, vi } from "vitest";

const chat = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/ai", async (original) => ({ ...await original<typeof import("@/lib/ai")>(), chatJSON: chat.fn }));

import { briefGate, briefRules, finalChecks, voiceChecks } from "@/lib/stage-gates";
import { parseThresholds } from "@/lib/gate-config";
import { combine, scriptStage, STAGES, stageKey, threshold } from "@/lib/stage-policy";
import type { AdScript, Brief, QualityFinding, Research } from "@/lib/types";

const usage = { costUsd: 0.0004 };
const research: Research = { brand: "OLIPOP", summary: "Prebiotic soda with 35 calories and 2g sugar", audience: "Soda lovers cutting sugar", valueProps: ["35 calories", "2g sugar", "9g fiber"], tone: "Playful", angles: ["swap", "taste"], sources: [] };
const good: Brief = { objective: "Drive first orders of Vintage Cola from soda lovers cutting sugar", audience: "Soda lovers cutting sugar after the holidays", insight: "People quit soda for health, then miss the ritual most at dinner.", offer: "35 calories, 2g sugar", mandatories: ["Real can in first 2s", "Brand colours", "Clear CTA"], kpi: "CPA under $25" };

beforeEach(() => chat.fn.mockReset());

describe("stage gates v2", () => {
  it("covers every stage from research to final QA with configurable thresholds (default 8, publish bar 9)", () => {
    expect(STAGES.map((s) => s.id)).toEqual(["research", "brief", "script", "shots", "voice", "video", "audio", "edit", "final"]);
    expect(threshold("brief")).toBe(8);
    expect(threshold("script")).toBe(8);
    expect(threshold("final")).toBe(9);
    expect(parseThresholds("script=8.5, final=9.5,bogus=3,edit=x")).toMatchObject({ script: 8.5, final: 9.5, edit: 8 });
    expect(stageKey("brief", "dir_0")).toBe("brief");
  });

  it("brief: rules catch an ungrounded offer and generic wording", () => {
    const bad = { ...good, offer: "Free shipping and lifetime guarantee", insight: "Innovative high-quality soda for everyone." };
    const rules = briefRules(bad, research);
    expect(rules.find((c) => c.name === "offer grounded")!.score).toBeLessThan(8);
    expect(rules.find((c) => c.name === "concrete audience & insight")!.score).toBe(5);
    expect(combine(briefRules(good, research))).toBeGreaterThanOrEqual(9);
  });

  it("brief: the judge lists issues, the score is computed, and fixes come back for the one retry", async () => {
    chat.fn.mockResolvedValueOnce({ data: { issues: [{ severity: "major", field: "offer", note: "Free shipping is not in the research; use '35 calories, 2g sugar'." }] }, usage });
    const g = await briefGate("judge", good, research, "Sell Vintage Cola", null);
    expect(g.score.pass).toBe(false);
    expect(g.fixes[0]).toMatch(/Free shipping/);
    chat.fn.mockResolvedValueOnce({ data: { issues: [] }, usage });
    const g2 = await briefGate("judge", good, research, "Sell Vintage Cola", null, 2);
    expect(g2.score.pass).toBe(true);
    expect(g2.score.attempts).toBe(2);
  });

  it("brief: a judge outage scores on rules only, never blocks on the outage itself", async () => {
    chat.fn.mockResolvedValueOnce({ data: { nope: 1 }, usage });
    const g = await briefGate("judge", good, research, "Sell", null);
    expect(g.score.pass).toBe(true);
  });

  it("voice & music: a line sped up to fit its beat or a second take costs points before any video spend", () => {
    const clean = voiceChecks([{ heard: true, tries: 1 }, { heard: true, tries: 1, tempo: 1.03 }], { planned: true, ok: true });
    expect(combine(clean)).toBeGreaterThanOrEqual(8);
    const rushed = voiceChecks([{ heard: true, tries: 2 }, { heard: true, tries: 1, tempo: 1.2 }], { planned: true, ok: true });
    expect(combine(rushed)).toBeLessThan(8);
    expect(rushed.find((c) => c.name === "fits its beat")!.note).toMatch(/×1\.20/);
  });

  it("final QA rubric: one broken area sinks the export even with a good craft score", () => {
    const f = (kind: QualityFinding["kind"], n: number): QualityFinding[] => Array.from({ length: n }, (_, i) => ({ kind, at: i, expected: "", observed: "", status: "fail", shotId: "s0" }));
    expect(combine(finalChecks({ craft: 9, findings: [], shotScores: [9, 10, 9] }))).toBeGreaterThanOrEqual(9);
    // OLIPOP final: craft 6, 7 OCR misses, 2 speech misses, shot 1 at 4.
    const olipop = combine(finalChecks({ craft: 6, findings: [...f("copy", 7), ...f("speech", 2), ...f("visual", 1)], shotScores: [4, 7, 7, 7] }));
    expect(olipop).toBeLessThanOrEqual(6);
  });

  it("script gate passes only with no proof problems or failed checks, and carries every fix note", () => {
    const s = { rounds: 1, checks: [], score: { overall: 8.5, scores: { hook: 9 }, notes: [], unsupported: [], proofProblems: ["The pour contradicts 'Tap Notify Me'."], panel: { stopRate: 0, quotes: [] } }, review: { judge: "j" } } as unknown as AdScript;
    const g = scriptStage(s)!;
    expect(g.pass).toBe(false);
    expect(g.notes[0]).toMatch(/Notify Me/);
    expect(g.attempts).toBe(2);
    expect(scriptStage({ ...s, score: { ...s.score!, proofProblems: [] } })!.pass).toBe(true);
  });
});

import { creativeBrief, operationalMandatory } from "@/lib/brief-policy";
describe("brief mandatories (Vintage Cola E2E)", () => {
  const vc = ["Confirm Vintage Cola is in stock before launching", "On-screen stat reveal: 9g fiber, 50 calories, 5g sugar", "Disclose: drinkolipop.com only, not combinable with other offers", "Close on 45 Day Money-Back Guarantee"];
  it("flags internal tasks and fine print, keeps creative requirements", () => {
    expect(vc.map(operationalMandatory)).toEqual([true, false, true, false]);
    expect(creativeBrief({ ...good, mandatories: vc }).mandatories).toEqual([vc[1], vc[3]]);
  });
  it("an operational mandatory sinks the brief gate (so it gets rewritten)", () => {
    expect(combine(briefRules({ ...good, mandatories: vc }, research))).toBeLessThanOrEqual(6);
  });
});
