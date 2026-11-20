import type { Brief, Research } from "@/lib/types";
import { ENGINES, BLENDER_TEMPLATES, SheetSchema, type ShotSheet, type StyleRule } from "@/lib/shot-sheet";
import { fitTimings } from "./timing";
import type { GateIssue } from "./gate";

/**
 * The script enhancer (PLAYBOOK 14.2): one text-model call writes the script and expands it into the director's shot
 * sheet. The app then normalises it (ids, routing, exact timings) so the gate sees a well-formed sheet.
 */
export type Chat = <T>(system: string, user: string) => Promise<{ data: T; usd: number }>;

export type SheetInput = {
  brand: string;
  goal: string;
  offer?: string | null;
  facts: string;
  brief: Brief | null;
  research: Research | null;
  rules: StyleRule[];
  targetSec: number;
  aspect: ShotSheet["aspect"];
  audioMode: ShotSheet["audioMode"];
  hasPhotos: boolean;
  patternId?: string;
};

const SYSTEM = `You are a commercial director and editor. You write a short ad script, then enhance it into a precise shot sheet a 3D artist, an AI video operator and an editor can execute exactly with no guesswork. Use only facts you are given; never invent numbers, rankings or features. When a story pattern is specified, follow its rules exactly.`;

export function sheetPrompt(i: SheetInput, fixes: GateIssue[] = []) {
  const patternPrompt = getPatternPrompt(i.patternId);
  
  return `Brand/product: ${i.brand}
Goal: ${i.goal}${i.offer ? `\nOffer: ${i.offer}` : ""}
Brief: ${i.brief ? JSON.stringify(i.brief) : "(none)"}
Audience and tone: ${i.research ? `${i.research.audience}; ${i.research.tone}` : "(none)"}
VERIFIED FACTS (the only claims allowed, on screen, in VO, on labels or on the end card):
${i.facts || "(none: make no factual claims)"}

STYLE RULES (follow every one):
${i.rules.map((r) => `- [${r.id}] ${r.text}`).join("\n") || "- (none)"}

${patternPrompt}

Format: ${i.targetSec}s total, aspect ${i.aspect}, 24 fps. Audio: ${i.audioMode === "foley" ? "FOLEY-FIRST: no voiceover; every shot gets one crisp close-miked sound effect on its action, plus a low bed under everything" : "voiceover: short spoken lines, max ~2.5 words per second, plus sound effects"}.
Engines per shot: "blender" for product, hero, label, macro, sign, object and abstract shots (free, readable labels, exact camera); "ai_video" only for people, hands or live action; "remotion" for pure text cards and the final end card. ${i.hasPhotos ? "Real product photos are available: product shots use blender template product_hero." : "No product photos available: do NOT use product_hero. Use glow_word, macro_label or lab templates instead."}
Blender templates: glow_word (neon tube lettering of "word"), macro_label (engraved "label" text on brushed metal, extreme macro), product_hero (real product photo - ONLY when photos are available), lab (smoked-glass panel with glowing gas tubes, a brass switch and engraved labels; good for detail/trigger/reveal loops).
The LAST shot must be the end card (engine remotion), and the shot before it transitions "fade_black".
For each shot's "sfx" line, write exact sounds tied to the on-screen action (e.g. "glass bottle set down on marble" not "thud"). The sound designer will use these to generate audio matched to the actual video.
${fixes.length ? `\nFIX THESE PROBLEMS FROM THE LAST DRAFT:\n${fixes.map((f) => `- ${f.text}`).join("\n")}\n` : ""}
Return JSON:
{"script":"the script as 2-6 lines",
 "sheet":{"targetSec":${i.targetSec},"audioMode":"${i.audioMode}","bed":"${i.patternId === 'confession_loop' ? '' : 'one line describing the music/drone bed (empty for confession_loop)'}","palette":"colour palette in a few words","patternId":"${i.patternId || 'confession_loop'}",
  "endCard":{"title":"product name","line":"where to get it, from the facts","footer":"one verified proof line or empty"},
  "shots":[{"start":0,"end":1.5,"shotType":"ECU macro|CU|MCU|MS|WS|EWS|insert|end card","framing":"what fills the frame and where","camera":{"angle":"eye level|low|high|top-down|dutch","move":"slow push-in 15%|slow orbit 20°|static","lensMm":100},"subject":"...","action":"what happens, with timing inside the shot","lighting":"key, rim, practicals, colour","text":null or {"copy":"exact words","placement":"diegetic on the plate|lower third|centre","chunks":["2-4","word","chunks"]},"audio":{"vo":null or "exact line","sfx":"exact sound and when, e.g. brass switch snap at 0.3s","music":null},"transition":"cut|fade_black|crossfade|whip","engine":"${ENGINES.join("|")}","blender":{"template":"${BLENDER_TEMPLATES.join("|")}","word":"...","label":"...","color":"#rrggbb","ignite":0.4} or null,"prompt":"for ai_video only: the full image-to-video prompt" or null,"editorNote":"one instruction to the editor for this cut","beat":"goal|personal_stake|stake_raised|physical_example|but_silence|owned_cause|low_point|crazy_plan|cut_before_attempt|takeaway"}]}}`;
}

function getPatternPrompt(patternId?: string): string {
  if (patternId === "confession_loop") {
    return `STORY PATTERN: "Confession loop"
Follow these rules EXACTLY:
1. Open with the goal in plain words in the very first sentence.
2. Tie the goal to something personal, then raise that stake once.
3. Show one small, physical example on screen instead of explaining in the abstract.
4. Bring in the problem with "but…" and follow it with about 1 second of silence (mark this with "beat":"but_silence").
5. Give the problem a specific cause the speaker owns.
6. At the low point, say out loud what the viewer is feeling (e.g. "now you're like, uh-oh"). Mark this shot with "beat":"low_point" and use framing "CU" for a close-up punch-in.
7. Follow the problem with a plan that sounds a little crazy. Mark this with "beat":"crazy_plan".
8. Cut before the attempt and never show the result.
9. Cut every 1.5–2 seconds during the setup (beats: goal, personal_stake, stake_raised, physical_example).
10. Hold ONE LONG TAKE (3+ seconds) on the confession (beat: low_point) and ONE LONG TAKE on the plan (beat: crazy_plan).
11. Cut away to a reaction or b-roll every 2–3 seconds the rest of the time.
12. After the close-up at the low point, go wide again (beat: takeaway should use "WS" or "MS" framing).
13. Keep captions to 2–4 short words at a time in the "chunks" array. Include one bright label in the first 3 seconds.
14. VO should be about 4 words per second. Slow down at the turn (beats: but_silence, low_point).
15. NO MUSIC: set "music":null for all shots and "bed":null.
16. End on the takeaway (beat: takeaway) with NO call to action, and echo the opening line so it loops.
17. Promise a rule that works on anything, then prove it with one tiny example (this is about the content angle, not shot-level).

BEATS IN ORDER (use these in the "beat" field):
goal → personal_stake → stake_raised → physical_example → but_silence → owned_cause → low_point → crazy_plan → cut_before_attempt → takeaway

VO LINES: At about 4 words per second (syllable budget enforced). The last VO line MUST echo the first line (60%+ token overlap).
CAPTIONS: 2-4 word chunks only, with one bright visual label in the first 3 seconds.
SILENCE: After the "but…" beat (but_silence), include ~1s of silence before the next VO.
NO CTA PHRASES: Never use "buy", "shop", "link in bio", "sign up", "learn more", "get yours", "order now", "try it", "download", or similar.`;
  }
  return ""; // No special pattern instructions for classic
}

/** Turn the model's raw sheet into a valid, routed, exactly-timed ShotSheet (or throw with the first schema error). */
export function normaliseSheet(raw: unknown, i: Pick<SheetInput, "targetSec" | "aspect" | "audioMode" | "rules" | "patternId">, version = 1): ShotSheet {
  const r = (raw ?? {}) as Record<string, unknown>;
  const shots = (Array.isArray(r.shots) ? r.shots : []).slice(0, 40).map((s: Record<string, unknown>, k: number) => {
    const audio = (s.audio ?? {}) as Record<string, unknown>;
    const cam = (s.camera ?? {}) as Record<string, unknown>;
    const b = s.blender as Record<string, unknown> | null | undefined;
    const text = s.text as Record<string, unknown> | null | undefined;
    const chunks = text && Array.isArray(text.chunks) ? text.chunks.map(String).filter(Boolean) : undefined;
    return {
      ...s,
      id: `s${k + 1}`,
      n: k + 1,
      start: Number(s.start) || 0,
      end: Number(s.end) || 0,
      camera: { angle: String(cam.angle ?? "eye level"), move: String(cam.move ?? "slow push-in"), lensMm: Number(cam.lensMm) || 50 },
      audio: { vo: i.audioMode === "foley" ? null : (audio.vo as string) || null, sfx: (audio.sfx as string) || null, music: (audio.music as string) || null },
      text: text && typeof text.copy === "string" && text.copy.trim() ? { copy: text.copy, placement: String(text.placement ?? "lower third"), chunks } : null,
      blender: b && BLENDER_TEMPLATES.includes(b.template as never) ? Object.fromEntries(Object.entries(b).filter(([, v]) => v !== null && v !== "")) : undefined,
      prompt: typeof s.prompt === "string" && s.prompt ? s.prompt : undefined,
      engine: ENGINES.includes(s.engine as never) ? s.engine : "blender",
      engineLocked: false,
      transition: ["cut", "fade_black", "crossfade", "whip"].includes(s.transition as string) ? s.transition : "cut",
      beat: typeof s.beat === "string" && s.beat ? s.beat : undefined,
    };
  });
  const sheet = SheetSchema.parse({
    version,
    targetSec: i.targetSec,
    aspect: i.aspect,
    fps: 24,
    audioMode: i.audioMode,
    bed: String(r.bed ?? "").slice(0, 200),
    palette: String(r.palette ?? "").slice(0, 120),
    rules: i.rules,
    endCard: r.endCard ?? { title: "Brand" },
    shots: shots.map((s) => ({ ...s, shotType: String((s as Record<string, unknown>).shotType ?? "CU"), subject: String((s as Record<string, unknown>).subject ?? "product") })),
    patternId: String(r.patternId || i.patternId || "confession_loop"),
  });
  // Renderer routing proper lives in the render pipeline; here the model's pick stands and the last shot is the card.
  const routed = sheet.shots.map((s) => ({ ...s }));
  const last = routed.length - 1;
  routed[last] = { ...routed[last], engine: "remotion" };
  return { ...sheet, shots: fitTimings(routed, sheet.targetSec) };
}

export async function writeSheet(i: SheetInput, chat: Chat, fixes: GateIssue[] = [], version = 1) {
  const { data, usd } = await chat<{ script?: string; sheet?: unknown }>(SYSTEM, sheetPrompt(i, fixes));
  return { script: String(data.script ?? ""), sheet: normaliseSheet(data.sheet, { ...i, patternId: i.patternId || "confession_loop" }, version), usd };
}
