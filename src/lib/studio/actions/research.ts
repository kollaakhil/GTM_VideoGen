import { brief, research, styleDNA } from "@/lib/pipeline";
import { brandRules } from "@/lib/brand-rules";
import { voiceOfCustomer, vocBlock } from "@/lib/ad-wisdom";
import { breakdownInspiration, swipeStructure } from "@/lib/inspiration";
import { newId, put, storeMedia } from "@/lib/store";
import type { InspirationBreakdown, StudioRun } from "@/lib/types";
import { now, say } from "../run-state";
import { goalCtx, brandFor, guidance } from "../context";
import type { ActionBody, Job } from "./types";

/**
 * Start screen job: brand research, customer language, the reference style and every inspiration's structural
 * breakdown, then (autoBrief) the brief, so the operator reviews and approves it all on one screen.
 */
export async function planResearch(run: StudioRun, body?: ActionBody<"research">): Promise<Job> {
  const m = run.models;
  const inputs = body?.inspirations ?? [];
  return {
    activity: inputs.length ? `Researching the brand and breaking down ${inputs.length} inspiration${inputs.length === 1 ? "" : "s"}…` : "Researching the brand…",
    work: async () => {
      const [r, dna, insp] = await Promise.all([
        research(m.text, run.brandUrl, goalCtx(run, brandRules(await brandFor(run)))),
        run.referenceUrl ? styleDNA(m.text, run.referenceUrl).catch(() => null) : null,
        Promise.all(inputs.map((input) => breakdownInspiration(input, m.vision).then((x) => ({ ok: true as const, ...x }), (e: Error) => ({ ok: false as const, error: e.message, source: input.url ?? input.name ?? "file" })))),
      ]);
      const voc = await voiceOfCustomer(m.text, run.brandUrl, r.data).catch(() => null);
      if (!voc) say(run, "error", "Couldn't gather customer language from Reddit or reviews; continuing with site research only.");
      const breakdowns: InspirationBreakdown[] = [];
      for (const x of insp) {
        if (!x.ok) {
          say(run, "error", `Couldn't break down ${x.source}: ${x.error.slice(0, 200)}`);
          continue;
        }
        const id = newId("swipe");
        const b = { ...x.breakdown, id, note: x.note, thumb: x.breakdown.thumb ? await storeMedia(x.breakdown.thumb, `swipes/${id}-thumb`) : null };
        breakdowns.push(b);
        if (x.note) say(run, "error", x.note);
        await put("swipes", { id, brandUrl: run.brandUrl, url: b.source.startsWith("upload:") ? null : b.source, image: b.thumb, note: `Inspiration from the start screen (${b.kind})`, structure: swipeStructure(b), breakdown: b, createdBy: run.createdBy, createdAt: now() });
      }
      const inspCost = breakdowns.reduce((s, b) => s + b.costUsd, 0);
      Object.assign(run, { research: r.data, voc: voc?.data ?? null, styleDNA: dna?.data ?? null, inspirations: breakdowns, stage: "brief", costUsd: run.costUsd + r.cost + (dna?.cost ?? 0) + (voc?.cost ?? 0) + inspCost });
      const parts = [dna ? `mapped ${dna.data.brand}'s creative style` : "", breakdowns.length ? `broke down ${breakdowns.length} inspiration${breakdowns.length === 1 ? "" : "s"} (${breakdowns.map((b) => b.kind === "video" ? `${b.shotCount} shots, ${b.avgShotSec}s avg` : b.kind).join("; ")})` : ""].filter(Boolean);
      if (!run.autoBrief) {
        say(run, "agent", `Research is done${parts.length ? `, and I ${parts.join(" and ")}` : ""}. Next: write the creative brief.`);
        return;
      }
      const b = await brief(m.text, run.research!, goalCtx(run, (await guidance(run)) + vocBlock(run.voc)), run.styleDNA);
      Object.assign(run, { brief: b.data, stage: "directions", directions: [], concepts: [], costUsd: run.costUsd + b.cost });
      say(run, "agent", `Research${parts.length ? ` (I ${parts.join(" and ")})` : ""} and the brief are ready. Review both here, edit the brief if you like, then approve it.`);
    },
  };
}
