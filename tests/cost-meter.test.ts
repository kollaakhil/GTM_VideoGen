import { describe, expect, it, vi } from "vitest";
import { BudgetExceeded, CostMeter, DEFAULT_CAP_USD, currentMeter, paid, withMeter } from "@/lib/render/cost-meter";
import { runParallel } from "@/lib/render/scheduler";

describe("CostMeter", () => {
  it("defaults to a $2 cap", () => {
    expect(DEFAULT_CAP_USD).toBe(2);
    expect(new CostMeter().snapshot()).toMatchObject({ capUsd: 2, spentUsd: 0, remainingUsd: 2, state: "ok" });
  });
  it("holds the estimate, then settles the real cost", () => {
    const m = new CostMeter({ capUsd: 2 });
    const r = m.reserve("video", 0.8);
    expect(m.snapshot()).toMatchObject({ reservedUsd: 0.8, spentUsd: 0, remainingUsd: 1.2 });
    r.settle(0.55);
    expect(m.snapshot()).toMatchObject({ reservedUsd: 0, spentUsd: 0.55, remainingUsd: 1.45, calls: 1 });
    r.settle(9); // double settle is ignored
    expect(m.snapshot().spentUsd).toBe(0.55);
  });
  it("refuses a call that would pass the cap, before anything is spent", () => {
    const m = new CostMeter({ capUsd: 1, spentUsd: 0.7 });
    expect(() => m.reserve("video", 0.4)).toThrow(BudgetExceeded);
    expect(() => m.reserve("video", 0.4)).toThrow(/Raise the cap/);
    expect(m.snapshot().reservedUsd).toBe(0);
    expect(() => m.reserve("tiny", 0.3)).not.toThrow(); // exactly to the cap is allowed
  });
  it("counts holds from calls in flight, so parallel calls cannot jointly overshoot", () => {
    const m = new CostMeter({ capUsd: 1 });
    m.reserve("a", 0.4);
    m.reserve("b", 0.4);
    expect(() => m.reserve("c", 0.4)).toThrow(BudgetExceeded);
  });
  it("releases the hold when the call fails", async () => {
    const m = new CostMeter({ capUsd: 1 });
    await expect(m.guard("x", 0.9, async () => { throw new Error("provider down"); }, () => 0)).rejects.toThrow("provider down");
    expect(m.snapshot()).toMatchObject({ reservedUsd: 0, spentUsd: 0 });
    await expect(m.guard("y", 0.9, async () => ({ cost: 0.5 }), (v) => v.cost)).resolves.toEqual({ cost: 0.5 });
    expect(m.snapshot().spentUsd).toBe(0.5);
  });
  it("reports ok, warn at 80% and blocked at the cap, and takes a raised cap", () => {
    const m = new CostMeter({ capUsd: 2 });
    m.record("a", 1.7);
    expect(m.snapshot().state).toBe("warn");
    m.record("b", 0.3);
    expect(m.snapshot()).toMatchObject({ state: "blocked", fraction: 1, remainingUsd: 0 });
    m.setCap(5);
    expect(m.snapshot()).toMatchObject({ state: "ok", remainingUsd: 3 });
    expect(() => m.setCap(0)).toThrow();
  });
  it("free calls always pass, even at the cap", () => {
    const m = new CostMeter({ capUsd: 1, spentUsd: 1 });
    expect(() => m.reserve("blender", 0)).not.toThrow();
  });
  it("notifies on every change for the live meter", () => {
    const seen: number[] = [];
    const m = new CostMeter({ capUsd: 2, onChange: (s) => seen.push(s.spentUsd + s.reservedUsd) });
    m.reserve("a", 0.5).settle(0.4);
    expect(seen).toEqual([0.5, 0.4]);
  });
  it("keeps the last calls in a ledger", () => {
    const m = new CostMeter({ capUsd: 5 });
    for (let i = 0; i < 12; i++) m.record(`c${i}`, 0.01);
    expect(m.snapshot().lastCalls.map((c) => c.label)).toEqual(["c4", "c5", "c6", "c7", "c8", "c9", "c10", "c11"]);
  });
});

describe("paid() gate (server side, per run via AsyncLocalStorage)", () => {
  it("is a pass-through with no meter", async () => {
    const fn = vi.fn(async () => ({ usage: { costUsd: 5 } }));
    await paid("x", 5, fn);
    expect(fn).toHaveBeenCalledOnce();
  });
  it("blocks BEFORE the provider is called when the estimate is over the cap", async () => {
    const provider = vi.fn(async () => ({ usage: { costUsd: 0.9 } }));
    const m = new CostMeter({ capUsd: 1, spentUsd: 0.5 });
    await withMeter(m, async () => {
      await expect(paid("video", 0.9, provider)).rejects.toBeInstanceOf(BudgetExceeded);
    });
    expect(provider).not.toHaveBeenCalled();
  });
  it("settles the provider's reported cost and exposes the meter inside the scope only", async () => {
    const m = new CostMeter({ capUsd: 2 });
    await withMeter(m, async () => {
      expect(currentMeter()).toBe(m);
      await paid("image", 0.1, async () => ({ usage: { costUsd: 0.06 } }));
    });
    expect(m.snapshot().spentUsd).toBe(0.06);
    expect(currentMeter()).toBeUndefined();
  });
  it("parallel renders under one meter stop at the cap and report the rest as failed, not retried", async () => {
    const m = new CostMeter({ capUsd: 1 });
    const provider = vi.fn(async () => { await new Promise((r) => setTimeout(r, 5)); return { usage: { costUsd: 0.4 } }; });
    const res = await withMeter(m, () => runParallel(Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, key: `k${i}`, run: () => paid("video", 0.4, provider) })), { limit: 4 }));
    expect(res.filter((r) => r.status === "ok")).toHaveLength(2);
    expect(res.filter((r) => r.status === "failed").every((r) => r.error instanceof BudgetExceeded && r.attempts === 1)).toBe(true);
    expect(provider).toHaveBeenCalledTimes(2);
    expect(m.snapshot().spentUsd).toBe(0.8);
  });
});
