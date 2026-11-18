import { describe, expect, it } from "vitest";
import { fmtSec, jobView } from "@/lib/job-progress";
import { finalBlockers } from "@/lib/stage-policy";
import type { StudioRun } from "@/lib/types";

const T0 = Date.parse("2026-11-18T12:00:00Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

describe("background video job progress", () => {
  it("drives the overall bar and per-shot bars from the persisted job", () => {
    const v = jobView({
      label: "Shot 2/3", done: 3, total: 6, phase: "rendering", startedAt: at(0), shots: [
        { id: "a", stage: "done", startedAt: at(10), endedAt: at(70) },
        { id: "b", stage: "rendering", startedAt: at(70) },
        { id: "c", stage: "queued" },
      ],
    }, T0 + 100_000);
    expect(v.shots.map((s) => [s.stage, s.pct])).toEqual([["done", 100], ["rendering", 45], ["queued", 0]]);
    expect(v.shots[1].eta).toBe(30);
    expect(v.shots[2].eta).toBeNull();
    expect(v.pct).toBe(58);
    expect(v.eta).toBeGreaterThan(0);
    expect(v.elapsed).toBe(100);
  });

  it("shows a queued job at a small non-zero bar with no ETA", () => {
    const v = jobView({ label: "Queued", done: 0, total: 0, phase: "queued", startedAt: at(0) }, T0 + 2000);
    expect(v).toMatchObject({ pct: 2, eta: null, shots: [] });
  });

  it("formats ETAs", () => {
    expect(fmtSec(42)).toBe("42s");
    expect(fmtSec(125)).toBe("2m 5s");
  });

  it("lists every final-video warning instead of only the first", () => {
    const run = {
      stageScores: {},
      directions: [{ id: "d", approvedScript: undefined, shots: [{ id: "s0", keyframe: "k", keyframeQa: { score: 5, match: "fail", notes: [], frames: [] } }] }],
    } as unknown as StudioRun;
    const list = finalBlockers(run, "d");
    expect(list.some((w) => /redraw keyframes 1/.test(w))).toBe(true);
    expect(finalBlockers(run, "missing")).toEqual([]);
  });
});
