import { list } from "./store";
import type { Creative } from "./types";

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

/** Human decisions and ad results score each past creative; only explicit rejections count against it. */
export function creativeScore(c: Creative) {
  const m = (c.metrics ?? null) as unknown as Record<string, number> | null;
  let s = 0;
  if (["approved", "paused", "live"].includes(c.status)) s += 2;
  if (c.feedback?.decision === "reject") s -= 3;
  if (c.qa?.pass) s += 1;
  if (c.qaOverride) s += 1;
  if (m?.roas) s += Math.min(3, m.roas);
  if (m?.ctr) s += Math.min(2, m.ctr * 100);
  return s;
}

export async function learnings(brandUrl: string) {
  const h = host(brandUrl);
  const runIds = new Set((await list("studio_runs")).filter((r) => host(r.brandUrl) === h).map((r) => r.id));
  const cs = (await list("creatives")).filter((c) => runIds.has(c.runId));
  const fmt = (c: Creative) => {
    const m = (c.metrics ?? null) as unknown as Record<string, number> | null;
    const perf = m?.roas ? `, ROAS ${m.roas.toFixed(1)}` : m?.ctr ? `, CTR ${(m.ctr * 100).toFixed(1)}%` : "";
    return `"${c.hook}" (angle: ${c.angle}; ${c.format}${perf})`;
  };
  const winners = cs.filter((c) => creativeScore(c) >= 2).sort((a, b) => creativeScore(b) - creativeScore(a)).slice(0, 5).map(fmt);
  const avoid = cs.filter((c) => c.feedback?.decision === "reject").slice(0, 5).map((c) => `${fmt(c)}${c.feedback?.reason ? ` because: ${c.feedback.reason}` : ""}`);
  const text = winners.length || avoid.length
    ? `\nWhat we learned from this brand's past creatives:${winners.length ? `\n- Worked (approved / passed / performed): ${winners.join("; ")}. Build on these angles and hook styles with fresh wording.` : ""}${avoid.length ? `\n- Rejected by the team: ${avoid.join("; ")}. Avoid these patterns.` : ""}`
    : "";
  return { winners, avoid, text };
}
