import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ chatJSON: vi.fn() }));
vi.mock("@/lib/ai", async (o) => ({ ...await o<object>(), chatJSON: mocks.chatJSON }));

import { scriptLab, WRITER } from "@/lib/script-lab";
import type { ScriptHook } from "@/lib/types";
import { brief, direction, proof, reference, research } from "./fixtures/script-proof";

const result = (data: object) => ({ data, usage: { costUsd: 0.01 } });
const fields = Object.fromEntries(["hook", "clarity", "specificity", "customerLanguage", "emotion", "productEarly", "cta", "pacing", "claims"].map((k) => [k, 9]));
const idOf = (prompt: string) => JSON.parse(prompt.split("Scripts:\n")[1].split("\nScore")[0])[0].id;
const hook = { id: "h1", type: "friction", ...reference.hook, review: { score: 9, note: "", blockers: [] } } as unknown as ScriptHook;
const ctx = { direction, brief, research, lengthSec: 15, proof } as Parameters<typeof scriptLab>[0];
const later = reference.beats.slice(1).map(({ visual, vo, onScreen }) => ({ visual, vo, onScreen }));

beforeEach(() => mocks.chatJSON.mockReset());

describe("script repair round (Vintage Cola E2E)", () => {
  it("can repair the opening shot's visual while its spoken line stays locked", async () => {
    mocks.chatJSON
      .mockResolvedValueOnce(result({ beats: later }))
      .mockImplementationOnce((_m, _s, p: string) => result({ scores: [{ id: idOf(p), overall: 6, scores: fields, notes: [], unsupported: [], proofProblems: ["Beat 1 shows an unmarked can; use the real labelled product."] }] }))
      .mockImplementationOnce((_m, _s, p: string) => {
        expect(p).toContain("Beat 1's \"vo\" is locked; you may rewrite its \"visual\"");
        expect(p).toContain("unmarked can");
        return result({ openingVisual: "Close-up: the real labelled can cracks open beside a dinner plate.", beats: later });
      })
      .mockImplementationOnce((_m, _s, p: string) => result({ scores: [{ id: idOf(p), overall: 9, scores: fields, notes: [], unsupported: [], proofProblems: [] }] }));
    const { script } = await scriptLab(ctx, hook, WRITER, "judge");
    expect(script.beats[0].visual).toMatch(/real labelled can/);
    expect(script.hook.visual).toBe(script.beats[0].visual);
    expect(script.beats[0].vo).toBe(reference.hook.spoken);
    expect(script.repair).toMatchObject({ kept: true, before: 6, after: 9 });
  });

  it("runs a second round for the judge's next note and may rewrite a vague opening overlay", async () => {
    mocks.chatJSON
      .mockResolvedValueOnce(result({ beats: later }))
      .mockImplementationOnce((_m, _s, p: string) => result({ scores: [{ id: idOf(p), overall: 6, scores: fields, notes: [], unsupported: [], proofProblems: ["Beat 3 needs the real label."] }] }))
      .mockResolvedValueOnce(result({ beats: later }))
      .mockImplementationOnce((_m, _s, p: string) => result({ scores: [{ id: idOf(p), overall: 7, scores: fields, notes: ["The opening overlay is vague on mute; use 'Love cola. Dread the sugar?'"], unsupported: [], proofProblems: [] }] }))
      .mockImplementationOnce((_m, _s, p: string) => {
        expect(p).toContain("openingOnScreen");
        return result({ openingOnScreen: "Love cola. Dread the sugar?", beats: later });
      })
      .mockImplementationOnce((_m, _s, p: string) => result({ scores: [{ id: idOf(p), overall: 8, scores: fields, notes: [], unsupported: [], proofProblems: [] }] }));
    const { script } = await scriptLab(ctx, hook, WRITER, "judge");
    expect(script.beats[0].onScreen).toBe("Love cola. Dread the sugar?");
    expect(script.hook.onScreen).toBe("Love cola. Dread the sugar?");
    expect(script.beats[0].vo).toBe(reference.hook.spoken);
    expect(script.score.overall).toBe(8);
    expect(script.repair).toMatchObject({ kept: true, before: 6, after: 8 });
  });

  it("records why a repair was discarded and keeps the graded draft", async () => {
    mocks.chatJSON
      .mockResolvedValueOnce(result({ beats: later }))
      .mockImplementationOnce((_m, _s, p: string) => result({ scores: [{ id: idOf(p), overall: 6, scores: fields, notes: ["Tighten beat 3."], unsupported: [], proofProblems: [], blockerBeat: 3 }] }))
      .mockResolvedValueOnce(result({ beats: [{ visual: "x", vo: "y", onScreen: "z".repeat(400) }] }))
      .mockImplementationOnce((_m, _s, p: string) => result({ scores: [{ id: idOf(p), overall: 5, scores: fields, notes: [], unsupported: ["Best cola ever"], proofProblems: [] }] }));
    const { script } = await scriptLab(ctx, hook, WRITER, "judge");
    expect(script.repair?.kept).toBe(false);
    expect(script.repair?.reason).toMatch(/discarded/);
    expect(script.score.overall).toBe(6);
  });
});
