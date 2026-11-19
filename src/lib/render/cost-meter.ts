import { AsyncLocalStorage } from "node:async_hooks";
import { DEFAULT_CAP_USD } from "./cap";

export { DEFAULT_CAP_USD };

export class BudgetExceeded extends Error {
  constructor(public readonly label: string, public readonly needUsd: number, public readonly capUsd: number, public readonly committedUsd: number) {
    super(`Over the run cap: "${label}" needs about $${needUsd.toFixed(2)} but only $${Math.max(0, capUsd - committedUsd).toFixed(2)} of the $${capUsd.toFixed(2)} cap is left. Nothing was spent on it. Raise the cap on this run to continue.`);
    this.name = "BudgetExceeded";
  }
}

export interface LedgerEntry { label: string; usd: number; at: string; estimated: number }

export interface MeterSnapshot {
  capUsd: number;
  spentUsd: number;
  /** Held for calls in flight. */
  reservedUsd: number;
  remainingUsd: number;
  /** 0..1 of the cap that is spent or held. */
  fraction: number;
  state: "ok" | "warn" | "blocked";
  calls: number;
  lastCalls: LedgerEntry[];
}

export interface Reservation {
  /** Records the real cost (may differ from the estimate). */
  settle(actualUsd: number): void;
  /** The call failed before it billed: give the hold back. */
  release(): void;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Per-run spend meter. `reserve` is synchronous, so parallel jobs can never jointly overshoot the cap: each call holds
 * its worst-case estimate before it starts, and the hold turns into the real cost when it settles.
 */
export class CostMeter {
  capUsd: number;
  private spent: number;
  private held = 0;
  private ledger: LedgerEntry[] = [];

  constructor(o: { capUsd?: number; spentUsd?: number; onChange?: (s: MeterSnapshot) => void } = {}) {
    this.capUsd = o.capUsd ?? DEFAULT_CAP_USD;
    this.spent = o.spentUsd ?? 0;
    this.onChange = o.onChange;
  }
  private onChange?: (s: MeterSnapshot) => void;

  setCap(usd: number) {
    if (!Number.isFinite(usd) || usd <= 0) throw new Error("The cap must be a positive amount in USD.");
    this.capUsd = usd;
    this.emit();
  }

  /** Throws BudgetExceeded when spent + held + estimate would pass the cap. Zero-cost calls always pass. */
  reserve(label: string, estimateUsd: number): Reservation {
    const est = Math.max(0, Number.isFinite(estimateUsd) ? estimateUsd : 0);
    if (est > 0 && round(this.spent + this.held + est) > this.capUsd + 1e-9) throw new BudgetExceeded(label, est, this.capUsd, this.spent + this.held);
    this.held = round(this.held + est);
    let open = true;
    const close = () => { open = false; this.held = Math.max(0, round(this.held - est)); };
    this.emit();
    return {
      settle: (actual) => {
        if (!open) return;
        close();
        const usd = Math.max(0, Number.isFinite(actual) ? actual : 0);
        this.spent = round(this.spent + usd);
        this.ledger.push({ label, usd: round(usd), estimated: round(est), at: new Date().toISOString() });
        this.emit();
      },
      release: () => { if (open) { close(); this.emit(); } },
    };
  }

  /** Reserve, run, settle with the call's own reported cost. A thrown error releases the hold. */
  async guard<T>(label: string, estimateUsd: number, fn: () => Promise<T>, costOf: (v: T) => number): Promise<T> {
    const r = this.reserve(label, estimateUsd);
    try {
      const v = await fn();
      r.settle(costOf(v));
      return v;
    } catch (e) {
      r.release();
      throw e;
    }
  }

  /** Spend recorded outside `guard` (legacy `run.costUsd += x` sites). Never throws. */
  record(label: string, usd: number) {
    this.spent = round(this.spent + Math.max(0, usd));
    this.ledger.push({ label, usd: round(usd), estimated: round(usd), at: new Date().toISOString() });
    this.emit();
  }

  snapshot(): MeterSnapshot {
    const committed = this.spent + this.held;
    const fraction = this.capUsd > 0 ? Math.min(1, committed / this.capUsd) : 1;
    return {
      capUsd: this.capUsd, spentUsd: round(this.spent), reservedUsd: round(this.held), remainingUsd: round(Math.max(0, this.capUsd - committed)), fraction,
      state: fraction >= 1 ? "blocked" : fraction >= 0.8 ? "warn" : "ok", calls: this.ledger.length, lastCalls: this.ledger.slice(-8),
    };
  }
  private emit() { this.onChange?.(this.snapshot()); }
}

const als = new AsyncLocalStorage<CostMeter>();
/** Runs `fn` with `meter` as the current run's meter: every paid call inside reserves against it. */
export const withMeter = <T>(meter: CostMeter, fn: () => Promise<T>) => als.run(meter, fn);
export const currentMeter = () => als.getStore();

/**
 * The gate every paid provider call goes through. With a meter in scope the estimate is held first (server side,
 * before any request leaves), and the real cost is settled afterwards. Without one (unit tests, scripts) it is a pass-through.
 */
export async function paid<T extends { usage: { costUsd: number } }>(label: string, estimateUsd: number, fn: () => Promise<T>): Promise<T> {
  const m = currentMeter();
  return m ? m.guard(label, estimateUsd, fn, (v) => v.usage.costUsd) : fn();
}
