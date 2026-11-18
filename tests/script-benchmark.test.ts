import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkScript, SCRIPT_TARGET } from "@/lib/script-lab";
import { crowded, reference } from "./fixtures/script-proof";

const rating = z.number().min(0).max(10);
const ratings = z.object({
  overall: rating, hook: rating, emotion: rating, specificity: rating, productTruth: rating,
  visualProof: rating, clarity: rating, cta: rating, phoneCopy: rating,
});
const candidate = z.object({
  id: z.string(), writer: z.string(), framework: z.string(), hook: z.object({ visual: z.string(), spoken: z.string(), onScreen: z.string() }),
  beats: z.array(z.object({ seconds: z.number().positive(), visual: z.string(), vo: z.string(), onScreen: z.string() })).min(2),
  cta: z.string(),
  human: ratings.optional(),
  grades: z.array(z.object({ judge: z.string(), overall: rating })).default([]),
});
const dataset = z.array(z.object({
  id: z.string(), lengthSec: z.number().int().min(6).max(30), mustSay: z.array(z.string()).default([]),
  proof: z.object({ tension: z.string(), claim: z.string(), action: z.string(), asset: z.string().optional(), offer: z.string(), cta: z.string() }),
  candidates: z.array(candidate).min(1),
})).min(1);

describe("offline script benchmark", () => {
  it("passes the authored control and rejects rushed VO, crowded copy and a changed cutoff", () => {
    expect(checkScript(reference, 15, ["Pay after approval"])).toEqual([]);
    expect(checkScript(crowded, 15, ["Pay after approval"])).toEqual(expect.arrayContaining([
      expect.stringContaining("VO needs"), expect.stringContaining("phone-safe lines"),
      expect.stringContaining('Keep the exact offer term: "Order 14+ days ahead"'),
    ]));
  });

  const file = process.env.SCRIPT_EVAL_FILE;
  if (file) it("reports relative writer quality and judge error on recorded comparisons", () => {
    const cases = dataset.parse(JSON.parse(readFileSync(file, "utf8")));
    const pairs = cases.flatMap((c) => c.candidates.map((s) => {
      const blocks = checkScript({ ...s, proofBrief: c.proof }, c.lengthSec, c.mustSay);
      return { case: c.id, candidate: s.id, writer: s.writer, human: s.human?.overall ?? null,
        blockers: blocks.join(" | "), models: s.grades.map((g) => ({ ...g,
          error: s.human ? g.overall - s.human.overall : null,
          falsePass: s.human ? g.overall >= SCRIPT_TARGET && (s.human.overall < SCRIPT_TARGET || !!blocks.length) : null,
        })) };
    }));
    console.table(pairs.map(({ models, ...row }) => row));
    console.table(pairs.flatMap(({ case: id, candidate, writer, models }) =>
      models.map((m) => ({ case: id, candidate, writer, ...m }))));
    expect(pairs.length).toBeGreaterThan(0);
  });
});
