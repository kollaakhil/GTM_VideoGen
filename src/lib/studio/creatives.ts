import { diversityScores, qa, render, retypeset } from "@/lib/pipeline";
import { claimsCheck, gateVerdict, preflightCopy } from "@/lib/gate";
import { planFix } from "@/lib/qa-triage";
import { videoReady } from "@/lib/quality-policy";
import { fitOffer, offerLine } from "@/lib/video-post";
import { list, mediaDataUrl, mediaFile, newId, put, storeMedia } from "@/lib/store";
import type { Creative, Direction, QAResult, StudioRun, VideoQuality } from "@/lib/types";
import { now, say, live, saveRun } from "./run-state";
import { AUTO_FIX_ATTEMPTS, TOURNAMENT_SIZE, brandFor, brandName } from "./context";

export async function saveCreative(
  run: StudioRun,
  d: Direction,
  out: { url: string; type: "image" | "video"; model: string; variants?: { aspect: string; url: string }[]; quality?: VideoQuality },
  q: QAResult,
  spent: number,
  diversity: number | null,
  onImageOffer?: string | null,
): Promise<Creative | null> {
  const stamp = Date.now();
  const mediaUrl = await storeMedia(out.url, `${run.id}/${d.id}-${stamp}`);
  const variants = await Promise.all(
    (out.variants ?? []).filter((v) => v.aspect !== "9:16").map(async (v) => ({ aspect: v.aspect, url: await storeMedia(v.url, `${run.id}/${d.id}-${stamp}-${v.aspect.replace(":", "x")}`) })),
  );
  const kit = await brandFor(run);
  const claims = await claimsCheck(run.models.text, {
    texts: [
      ...(d.format === "static" && process.env.STATIC_TYPESET !== "off" ? [`On-image text: ${d.copy?.metaHeadline || d.hook} / ${onImageOffer !== undefined ? onImageOffer ?? "" : fitOffer(offerLine(kit?.offer || run.offer || run.brief?.offer)).text} / ${kit?.mustSay?.join(" · ") ?? ""}`] : []),
      ...(out.quality ? out.quality.shots.flatMap((s) => [s.vo, s.onScreen]) : [d.hook, d.script]),
      d.copy?.metaPrimaryText ?? "", d.copy?.metaHeadline ?? "", ...(d.copy?.googleHeadlines ?? []), ...(d.copy?.googleDescriptions ?? []),
    ],
    research: run.research!, brief: run.brief!, offer: run.offer, mustSay: kit?.mustSay,
  }).catch(() => null);
  const gate = gateVerdict({ qa: q.score, diversity, unsupported: claims?.data.unsupported ?? [], missing: claims?.data.missing ?? [] });
  if (out.quality) {
    if (!claims) gate.reasons.push("Claims review could not be completed.");
    if (!videoReady(out.quality)) gate.reasons.push("Video needs passing script-match and export evidence.");
    if (out.quality.tier !== "final") gate.reasons.push("Approve a verified HD export, not a draft.");
    gate.pass = !gate.reasons.length;
  }
  const creative: Creative = {
    id: newId("cr"),
    runId: run.id,
    directionId: d.id,
    copy: d.copy ?? null,
    title: d.title,
    hook: d.hook,
    angle: d.angle,
    format: d.format,
    mediaUrl,
    variants,
    mediaType: out.type,
    model: out.model,
    qa: q,
    quality: out.quality,
    qaOverride: null,
    diversity,
    status: "draft",
    channel: null,
    metrics: null,
    costUsd: spent + (claims?.cost ?? 0),
    gate,
    conceptId: (run.concepts ?? []).filter((c) => c.selected)[run.directions.indexOf(d)]?.id ?? null,
    createdAt: now(),
  };
  if (!live(run)) return null;
  await put("creatives", creative);
  for (const old of await list("creatives")) {
    if (old.runId === run.id && old.directionId === d.id && old.id !== creative.id && old.status === "draft") await put("creatives", { ...old, status: "rejected" });
  }
  run.creativeIds = [...run.creativeIds.filter((id) => id !== creative.id), creative.id];
  run.costUsd += (out.quality ? 0 : spent) + (claims?.cost ?? 0);
  run.progress[d.id] = "done";
  await saveRun(run);
  return creative;
}

export async function generateMany(run: StudioRun, dirs: Direction[], refs: string[]) {
  const m = run.models;
  const div = diversityScores(run.directions.map((d) => `${d.angle} ${d.visualPrompt}`));
  const kit = await brandFor(run);
  const staticKit = process.env.STATIC_TYPESET === "off" ? null : {
    brand: kit?.name && !kit.name.includes(".") ? kit.name : run.research?.brand || brandName(run.brandUrl),
    offer: offerLine(kit?.offer || run.offer || run.brief?.offer) || null,
    primary: kit?.colorRoles?.primary || run.research?.colors?.[0] || null,
    footer: kit?.mustSay?.length ? kit.mustSay.join(" · ") : null,
    logo: kit?.logo ? await mediaDataUrl(kit.logo).catch(() => null) : null,
    fontFile: kit?.font?.file ? await mediaFile(kit.font.file).catch(() => null) : null,
    fontFamily: kit?.font?.family ?? null,
  };
  const results = await Promise.allSettled(
    dirs.map(async (d) => {
      const i = run.directions.indexOf(d);
      let dirKit = staticKit;
      let preSpent = 0;
      if (d.format === "static" && staticKit) {
        // Claims check on the on-image copy before any image is paid for (bug C).
        const pf = await preflightCopy(m.text, { headline: d.copy?.metaHeadline || d.hook, offer: staticKit.offer ? fitOffer(staticKit.offer).text : null, research: run.research!, brief: run.brief!, offerTerms: run.offer }).catch(() => null);
        if (pf) {
          preSpent = pf.cost;
          if (d.copy) d.copy = { ...d.copy, metaHeadline: pf.headline };
          else d.hook = pf.headline;
          dirKit = { ...staticKit, offer: pf.offer };
          for (const c of pf.changes) say(run, "agent", `“${d.title}”: ${c}.`);
        }
      }
      const opts = { imageModel: m.image, videoModel: m.video, refs, seed: i, brand: run.research?.brand || brandName(run.brandUrl), style: { styleRef: run.research?.styleRef, colors: run.research?.colors }, kit: dirKit };
      run.progress[d.id] = "rendering";
      await saveRun(run);
      const takes = d.format === "static" ? TOURNAMENT_SIZE : 1;
      const candidates = await Promise.all(Array.from({ length: takes }, (_, t) => render(d, { ...opts, seed: i * 10 + t })));
      run.progress[d.id] = "qa";
      await saveRun(run);
      const graded = await Promise.all(candidates.map(async (c) => ({ out: c, q: await qa(m.vision, c.url, c.type, run.brief!, d.hook) })));
      graded.sort((a, b) => b.q.data.score - a.q.data.score);
      let { out, q } = graded[0];
      let spent = preSpent + graded.reduce((n, g) => n + g.out.cost + g.q.cost, 0);
      if (takes > 1) q = { ...q, data: { ...q.data, notes: [`Best of ${takes} takes (scores ${graded.map((g) => g.q.data.score).join(", ")})`, ...q.data.notes] } };
      // Bug B: text-layout notes are fixed by re-typesetting the same scene (free); only picture notes buy a new render.
      let tighter = 0;
      for (let a = 0; a < AUTO_FIX_ATTEMPTS && !q.data.pass && out.type === "image"; a++) {
        const plan = planFix(q.data.notes, !!opts.kit && !!out.scene);
        if (!plan.rerender && !plan.retypeset) break;
        run.progress[d.id] = "fixing";
        await saveRun(run);
        if (plan.retypeset) tighter++;
        const retry = plan.rerender
          ? await render(d, { ...opts, seed: i * 10 + takes + a, fixes: plan.imageFixes, tighter })
          : { ...out, url: await retypeset(out.scene!, d, opts.kit!, tighter), cost: 0 };
        const rq = await qa(m.vision, retry.url, retry.type, run.brief!, d.hook);
        spent += retry.cost + rq.cost;
        if (rq.data.score >= q.data.score) {
          const how = plan.rerender ? "Auto-fixed after QA" : "Auto-retypeset after QA, no new render";
          q = { ...rq, data: { ...rq.data, notes: [`${how} (was ${q.data.score}/10)`, ...rq.data.notes] } };
          out = retry;
        }
      }
      await saveCreative(run, d, out, q.data, spent, div[i] ?? null, d.format === "static" && opts.kit ? (opts.kit.offer ? fitOffer(opts.kit.offer).text : null) : undefined);
    }),
  );
  results.forEach((r, k) => {
    if (r.status === "rejected") {
      run.progress[dirs[k].id] = "failed";
      say(run, "error", `“${dirs[k].title}” failed: ${String(r.reason?.message ?? r.reason).slice(0, 300)}`);
    }
  });
}
