import path from "node:path";
import fs from "node:fs/promises";
import ffmpegPath from "ffmpeg-static";
import { list, newId, put } from "./store";
import { run as exec, withTemp } from "./local-tools";
import { judgeContinuity, judgeResearch, judgeShots } from "./stage-gates";
import { combine } from "./stage-policy";
import type { JudgeCalibration, Research, Shot } from "./types";

/**
 * QA of the QA: a small labeled golden set per judge. A judge that scores a known-bad item at or above the
 * stage threshold is inflated by that margin; later scores from that judge are reduced by the mean inflation.
 * Every disagreement with the label is stored for review.
 */
const SITE = "Lumen Bottle. The self-cleaning water bottle. UV-C LED cap kills 99% of bacteria in 60 seconds. Double-wall stainless steel keeps water cold 24 hours. 17 oz. USB-C charging, one charge lasts a month. $79. Free returns within 30 days. 4.7 stars from 2,100 reviews. Made for commuters and gym-goers.";
const goodResearch: Research = { brand: "Lumen", summary: "Self-cleaning stainless bottle with a UV-C cap that kills 99% of bacteria in 60 seconds.", audience: "Commuters and gym-goers", valueProps: ["UV-C cap kills 99% of bacteria in 60 s", "Cold for 24 hours", "One USB-C charge lasts a month"], tone: "Clean, confident", angles: ["No more smelly bottle", "Cold all day", "Charge once a month"], sources: ["https://lumen.example"], competitors: [{ name: "LARQ", difference: "LARQ also sells UV bottles" }, { name: "Hydro Flask", difference: "Insulated, no UV" }] };
const badResearch: Research = { ...goodResearch, summary: "The only FDA-approved bottle, rated #1 by doctors, that purifies any water source including seawater.", valueProps: ["FDA approved", "Desalinates seawater", "Lifetime battery"], competitors: [{ name: "AquaZorb Industries" }] };

const shot = (id: string, beat: string, visual: string, camera: string, expectedVisual: string): Shot => ({ id, beat, seconds: 3, visual, camera, vo: "", expectedVisual, status: "planned" });
const goodShots = [
  shot("a", "hook", "Close-up, 50mm: Maya, 30s, short black hair, grey hoodie, sniffs an old plastic bottle in a sunlit white kitchen and winces; soft window light from the left.", "slow push-in", "Maya sniffs an old bottle and winces"),
  shot("b", "proof", "Medium shot, 35mm: Maya, short black hair, grey hoodie, presses the glowing blue cap of the matte black Lumen bottle on the same white kitchen counter; soft window light from the left.", "static, eye level", "Maya presses the glowing cap"),
  shot("c", "cta", "Close-up, 85mm: the matte black Lumen bottle on the white kitchen counter, cap glowing blue, Maya's hand in grey hoodie sleeve picks it up; soft window light from the left.", "slow pull-out", "Hand picks up the bottle"),
];
const badShots = [
  shot("a", "hook", "A person with a bottle.", "", "Maya sniffs an old bottle and winces"),
  shot("b", "proof", "Blonde man surfing at sunset holding a red can.", "drone", "Maya presses the glowing cap"),
  shot("c", "cta", "Logo.", "", "Hand picks up the bottle"),
];

type Item = { kind: "research" | "shots" | "continuity"; item: string; label: "pass" | "fail"; expected: number; score: () => Promise<{ got: number | null; cost: number; note: string }> };

/** Three "shots" of one bottle on one set: wide, medium and close framings, so only the bottle's color varies by item. */
const FRAMINGS = [{ x: 140, y: 300, w: 80, h: 150 }, { x: 110, y: 200, w: 140, h: 260 }, { x: 60, y: 90, w: 240, h: 450 }];

async function frames(dir: string, colors: string[]) {
  // Each item gets its own files: items are judged in parallel.
  const tag = colors.join("-").replace(/0x/g, "");
  const out: { at: number; url: string }[] = [];
  for (const [i, c] of colors.entries()) {
    const file = path.join(dir, `${tag}-${i}.jpg`);
    const f = FRAMINGS[i % FRAMINGS.length];
    const cap = Math.round(f.h * 0.15);
    await exec(ffmpegPath as string, ["-y", "-f", "lavfi", "-i", "color=c=0xf2efe9:s=360x640", "-vf", `drawbox=x=0:y=${f.y + f.h}:w=360:h=${640 - f.y - f.h}:color=0x8a6a4a@1:t=fill,drawbox=x=${f.x}:y=${f.y}:w=${f.w}:h=${f.h}:color=${c}@1:t=fill,drawbox=x=${f.x + Math.round(f.w * 0.15)}:y=${f.y - cap}:w=${Math.round(f.w * 0.7)}:h=${cap}:color=0x222222@1:t=fill`, "-frames:v", "1", file]);
    out.push({ at: i * 3, url: `data:image/jpeg;base64,${(await fs.readFile(file)).toString("base64")}` });
  }
  return out;
}

export function goldenSet(model: string, dir: string): Item[] {
  const research = (r: Research) => async () => {
    const j = await judgeResearch(model, r, SITE);
    return { got: j.checks.length ? combine(j.checks) : null, cost: j.cost, note: j.unsupported.join("; ") || j.notes.join("; ") };
  };
  const shots = (s: Shot[]) => async () => {
    const j = await judgeShots(model, s);
    return { got: j.checks.length ? combine(j.checks) : null, cost: j.cost, note: j.fixes.slice(0, 3).join("; ") };
  };
  const cont = (colors: string[]) => async () => {
    const j = await judgeContinuity(model, await frames(dir, colors));
    return { got: j.score, cost: j.cost, note: j.notes.join("; ") };
  };
  return [
    { kind: "research", item: "grounded research", label: "pass", expected: 8.5, score: research(goodResearch) },
    { kind: "research", item: "hallucinated claims and invented competitor", label: "fail", expected: 3, score: research(badResearch) },
    { kind: "shots", item: "specific, consistent shot list", label: "pass", expected: 8.5, score: shots(goodShots) },
    { kind: "shots", item: "vague shots, cast and set change", label: "fail", expected: 2, score: shots(badShots) },
    { kind: "continuity", item: "same black bottle, wide/medium/close", label: "pass", expected: 9, score: cont(["0x111111", "0x111111", "0x111111"]) },
    { kind: "continuity", item: "bottle turns red, then blue", label: "fail", expected: 3, score: cont(["0x111111", "0xd02020", "0x2040d0"]) },
  ];
}

const PASS_AT: Record<Item["kind"], number> = { research: 8, shots: 8, continuity: 8 };

/** Summarises golden-set results into per-judge accuracy, inflation and disagreements. Exported for tests. */
export function summarize(model: string, results: { kind: Item["kind"]; item: string; label: "pass" | "fail"; expected: number; got: number | null; note: string }[]) {
  const judges: JudgeCalibration["judges"] = [];
  const disagreements: JudgeCalibration["disagreements"] = [];
  for (const kind of ["research", "shots", "continuity"] as const) {
    const rows = results.filter((r) => r.kind === kind && r.got !== null);
    if (!rows.length) continue;
    const ok = rows.filter((r) => (r.got! >= PASS_AT[kind]) === (r.label === "pass")).length;
    const bad = rows.filter((r) => r.label === "fail");
    const inflation = bad.length ? bad.reduce((s, r) => s + Math.max(0, r.got! - (PASS_AT[kind] - 1)), 0) / bad.length : 0;
    // The video, audio and edit gates use the continuity judge's frames; research and shots use their own kinds.
    judges.push({ judge: model, kind: kind === "continuity" ? "edit" : kind, accuracy: Math.round((ok / rows.length) * 100) / 100, inflation: Math.round(inflation * 10) / 10, items: rows.length });
    for (const r of rows) if ((r.got! >= PASS_AT[kind]) !== (r.label === "pass")) disagreements.push({ kind, item: r.item, label: r.label, expected: r.expected, got: r.got!, note: r.note.slice(0, 300) });
  }
  return { judges, disagreements };
}

export async function calibrateJudges(model: string): Promise<JudgeCalibration> {
  return withTemp("gtm-calib-", async (dir) => {
    const items = goldenSet(model, dir);
    const results = await Promise.all(items.map(async (i) => {
      const r = await i.score().catch((e: Error) => ({ got: null, cost: 0, note: `Judge error: ${e.message.slice(0, 200)}` }));
      return { kind: i.kind, item: i.item, label: i.label, expected: i.expected, ...r };
    }));
    const cal: JudgeCalibration = { id: newId("cal"), createdAt: new Date().toISOString(), ...summarize(model, results), costUsd: results.reduce((s, r) => s + r.cost, 0) };
    await put("judge_calibrations", cal);
    return cal;
  });
}

export async function latestCalibration(): Promise<JudgeCalibration | null> {
  return (await list("judge_calibrations").catch(() => []))[0] ?? null;
}
