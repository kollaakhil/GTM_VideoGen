import { research, styleDNA } from "@/lib/pipeline";
import { gatedBrief } from "../brief-gate";
import { brandRules } from "@/lib/brand-rules";
import { voiceOfCustomer, vocBlock } from "@/lib/ad-wisdom";
import { breakdownInspiration, swipeStructure } from "@/lib/inspiration";
import { newId, put, storeMedia } from "@/lib/store";
import { better, gateJudge, researchGate, scrubResearch } from "@/lib/stage-gates";
import { saveStage, stageBlock } from "@/lib/stage-policy";
import { latestCalibration } from "@/lib/judge-calibration";
import type { InspirationBreakdown, StudioRun, VoiceOfCustomer } from "@/lib/types";
import { aiConfigured } from "@/lib/ai";
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
      const goal = goalCtx(run, brandRules(await brandFor(run)));
      const [first, dna, insp] = await Promise.all([
        research(m.text, run.brandUrl, goal),
        run.referenceUrl ? styleDNA(m.text, run.referenceUrl).catch(() => null) : null,
        Promise.all(inputs.map((input) => breakdownInspiration(input, m.vision).then((x) => ({ ok: true as const, ...x }), (e: Error) => ({ ok: false as const, error: e.message, source: input.url ?? input.name ?? "file" })))),
      ]);
      let r = first;
      const voc = await voiceOfCustomer(m.text, run.brandUrl, r.data).catch(() => null);
      if (!voc) say(run, "error", "Couldn't gather customer language from Reddit or reviews; continuing with site research only.");
      const gated = await gateResearch(run, r, voc?.data, (fixes, site) => research(m.text, run.brandUrl, goal, fixes, site));
      r = gated.r;
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
      
      // Store scraped product photos as run photos
      const productPhotoUrls: string[] = [];
      if (r.data.productPhotos && r.data.productPhotos.length > 0) {
        for (const photo of r.data.productPhotos) {
          try {
            const stored = await storeMedia(photo.url, `${run.id}/product-${newId("img")}`);
            productPhotoUrls.push(stored);
            say(run, "agent", `Found product image from ${new URL(photo.sourceUrl).hostname}`);
          } catch (e) {
            console.warn(`Failed to store product photo from ${photo.sourceUrl}:`, e);
          }
        }
      }
      
      // Merge scraped photos into run.storyboardPhotos (StudioRun uses storyboardPhotos, not input.photos)
      const existingPhotos = run.storyboardPhotos ?? [];
      const allPhotos = [...existingPhotos, ...productPhotoUrls];
      Object.assign(run, { 
        research: r.data, 
        voc: voc?.data ?? null, 
        styleDNA: dna?.data ?? null, 
        inspirations: breakdowns, 
        stage: "brief", 
        costUsd: run.costUsd + gated.cost + (dna?.cost ?? 0) + (voc?.cost ?? 0) + inspCost,
        storyboardPhotos: allPhotos
      });
      const gateLine = gated.line;
      const parts = [dna ? `mapped ${dna.data.brand}'s creative style` : "", breakdowns.length ? `broke down ${breakdowns.length} inspiration${breakdowns.length === 1 ? "" : "s"} (${breakdowns.map((b) => b.kind === "video" ? `${b.shotCount} shots, ${b.avgShotSec}s avg` : b.kind).join("; ")})` : ""].filter(Boolean);
      if (!run.autoBrief) {
        say(run, "agent", `Research is done${parts.length ? `, and I ${parts.join(" and ")}` : ""}. Next: write the creative brief.${gateLine}`);
        return;
      }
      const b = await gatedBrief(run, m.text, goalCtx(run, (await guidance(run)) + vocBlock(run.voc)));
      Object.assign(run, { brief: b.data, stage: "directions", directions: [], concepts: [], costUsd: run.costUsd + b.cost });
      say(run, "agent", `Research${parts.length ? ` (I ${parts.join(" and ")})` : ""} and the brief are ready. Review both here, edit the brief if you like, then approve it.${gateLine}${b.line}`);
    },
  };
}

type Researched = Awaited<ReturnType<typeof research>>;

/**
 * Research gate: source coverage, real competitors, evidence and no facts the site doesn't support.
 * One retry with the judge's notes on the same fetched page; keeps the better attempt. Skipped in demo mode.
 * Returns the research to keep, its total cost (both attempts plus judging) and a chat line.
 */
async function gateResearch(run: StudioRun, r: Researched, voc: VoiceOfCustomer | undefined, retry: (fixes: string[], site: NonNullable<Researched["site"]>) => Promise<Researched>) {
  if (!aiConfigured()) return { r, cost: r.cost, line: "" };
  const cal = await latestCalibration();
  const judge = gateJudge(run);
  let gate = await researchGate(judge, r.data, voc, r.site?.text ?? "", cal);
  let cost = r.cost;
  if (!gate.score.pass && r.site) {
    const again = await retry(gate.fixes, r.site).catch(() => null);
    if (again) {
      cost += again.cost;
      const g2 = await researchGate(judge, again.data, voc, again.site?.text ?? "", cal, 2);
      if (g2.score.score >= gate.score.score) r = again;
      gate = better(gate, g2);
    }
  }
  // Still citing facts the site doesn't have: cut them out and re-check (one more cheap judge call).
  if (!gate.score.pass && gate.unsupported.length && r.site) {
    const scrubbed = { ...r, data: scrubResearch(r.data, gate.unsupported) };
    const g3 = await researchGate(judge, scrubbed.data, voc, r.site.text, cal, gate.score.attempts + 1);
    if (g3.score.score >= gate.score.score) r = scrubbed;
    gate = better(gate, g3);
  }
  saveStage(run, gate.score);
  const blocked = stageBlock(run, "research");
  return { r, cost: cost + gate.cost, line: ` Research gate: ${gate.score.score}/10${gate.score.attempts > 1 ? ` after ${gate.score.attempts} attempts` : ""}.${blocked ? ` ${blocked}` : ""}` };
}
