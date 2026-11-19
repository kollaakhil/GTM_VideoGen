import { providerOf } from "./models";

const OR_URL = "https://openrouter.ai/api/v1/chat/completions";

export type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type Msg = { role: "system" | "user" | "assistant"; content: string | Part[] };

export interface Usage {
  costUsd: number;
  /** Higgsfield subscription credits, when paid that way. */
  credits?: number;
}

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const prices = new Map<string, [number, number]>();

/** OpenRouter's public list prices (USD per token), used to cost direct OpenAI calls the same way. */
async function listPrice(model: string): Promise<[number, number] | null> {
  if (!prices.size) {
    const r = await fetch("https://openrouter.ai/api/v1/models").then((x) => (x.ok ? x.json() : null)).catch(() => null);
    for (const m of r?.data ?? []) prices.set(m.id, [Number(m.pricing?.prompt) || 0, Number(m.pricing?.completion) || 0]);
  }
  return prices.get(model) ?? null;
}

/** openai/* models go straight to OpenAI when OPENAI_API_KEY is set; everything else via OpenRouter. */
const viaOpenAI = (model: string) => model.startsWith("openai/") && !!process.env.OPENAI_API_KEY;

async function chat(body: Record<string, unknown> & { model: string }) {
  if (!viaOpenAI(body.model)) return openrouter(body);
  const model = body.model.slice("openai/".length);
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, model }),
    });
    if ((res.status !== 429 && res.status < 500) || attempt >= 4) break;
    const after = Number(res.headers.get("retry-after"));
    await new Promise((r) => setTimeout(r, (after > 0 ? Math.min(after, 60) : 4 * 2 ** attempt) * 1000 + Math.random() * 1000));
  }
  if (!res.ok) {
    const t = await res.text();
    if (t.includes("insufficient_quota")) throw new Error("OpenAI API balance is empty. Add credit at platform.openai.com/settings/organization/billing, then retry.");
    throw new Error(`OpenAI ${res.status}: ${t.slice(0, 300)}`);
  }
  const json = await res.json();
  const p = await listPrice(body.model);
  const u = json.usage ?? {};
  json.usage = { ...u, cost: p ? (u.prompt_tokens ?? 0) * p[0] + (u.completion_tokens ?? 0) * p[1] : 0 };
  return json;
}

async function openrouter(body: Record<string, unknown>) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(OR_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Title": "GTM Engine",
      },
      body: JSON.stringify({ ...body, usage: { include: true } }),
    });
    // Rate limits and transient provider errors: back off and retry (honours Retry-After).
    const inFlight = res.status === 402 && (await res.clone().text()).includes("in_flight_budget");
    if ((res.status !== 429 && res.status < 500 && !inFlight) || attempt >= 4) break;
    const after = Number(res.headers.get("retry-after"));
    await new Promise((r) => setTimeout(r, (after > 0 ? Math.min(after, 60) : 4 * 2 ** attempt) * 1000 + Math.random() * 1000));
  }
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

function extractJSON(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(raw);
}

export async function chatJSON<T>(model: string, system: string, user: string | Part[]): Promise<{ data: T; usage: Usage }> {
  const messages: Msg[] = [
    { role: "system", content: `${system}\nRespond with a single valid JSON object only.` },
    { role: "user", content: user },
  ];
  let cost = 0;
  for (let attempt = 0; ; attempt++) {
    const json = await chat({ model, messages, response_format: { type: "json_object" } });
    cost += json.usage?.cost ?? 0;
    const text: string = json.choices?.[0]?.message?.content ?? "";
    try {
      return { data: extractJSON(text) as T, usage: { costUsd: cost } };
    } catch (e) {
      if (attempt >= 1) throw new Error(`${model} returned invalid JSON twice (${(e as Error).message.slice(0, 80)})`);
      messages.push({ role: "assistant", content: text.slice(0, 20_000) }, { role: "user", content: `That was not valid JSON (${(e as Error).message.slice(0, 120)}). Return the complete answer again as one valid JSON object; escape every double quote inside strings.` });
    }
  }
}

export async function generateImage(model: string, prompt: string, refs: string[] = []): Promise<{ url: string; usage: Usage }> {
  const content: Part[] = [{ type: "text", text: prompt }, ...refs.map((url) => ({ type: "image_url" as const, image_url: { url } }))];
  const json = await openrouter({ model, modalities: ["image", "text"], messages: [{ role: "user", content }] });
  const url: string | undefined = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error("Image model returned no image");
  return { url, usage: { costUsd: json.usage?.cost ?? 0 } };
}

const FAL_QUEUE = "https://queue.fal.run/";
const falFamily = (model: string) => (model.includes("/seedance/") ? "seedance" : model.includes("kling-video/") ? "kling" : model.includes("veo3") ? "veo" : "other");

/** Clip lengths each fal video family accepts. */
export function falDurations(model: string): number[] {
  const f = falFamily(model);
  return f === "seedance" ? [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : f === "kling" ? [5, 10] : f === "veo" ? [4, 6, 8] : [5];
}

/** Turns fal error bodies into a message a Studio user can act on. */
export function falError(status: number, body: string): string {
  if (/exhausted balance|insufficient|locked|top up|billing/i.test(body) || status === 402) return "fal.ai balance is empty. Add funds at fal.ai/dashboard/billing, then retry.";
  if (status === 401 || status === 403) return `fal.ai rejected the key (${status}). Check FAL_KEY on the Connections page.`;
  return `fal ${status}: ${body.slice(0, 300)}`;
}

/** Request body for a fal image-to-video model; exported for tests. */
export function falVideoBody(model: string, prompt: string, o: VideoOpts) {
  const f = falFamily(model);
  const duration = String(nearest(falDurations(model), o.seconds ?? 5));
  const body: Record<string, unknown> = { prompt: prompt.slice(0, 2500) };
  if (o.firstFrame) body.image_url = o.firstFrame;
  if (f === "seedance") {
    Object.assign(body, { duration, resolution: ["480p", "720p", "1080p"].includes(o.resolution ?? "") ? o.resolution : "480p", aspect_ratio: "9:16" });
    if (o.lastFrame && model.includes("/lite/")) body.end_image_url = o.lastFrame;
  } else if (f === "kling") {
    body.duration = duration;
    if (o.lastFrame) body.tail_image_url = o.lastFrame;
  } else if (f === "veo") {
    Object.assign(body, { duration: `${duration}s`, aspect_ratio: "9:16", resolution: o.resolution === "1080p" ? "1080p" : "720p", generate_audio: o.audio ?? false });
  } else body.duration = duration;
  return body;
}

const falPriceCache = new Map<string, Promise<{ unit: string; price: number } | null>>();
function falUnitPrice(model: string) {
  if (!falPriceCache.has(model)) {
    falPriceCache.set(
      model,
      (async () => {
        try {
          const res = await fetch(`https://api.fal.ai/v1/models/pricing?endpoint_id=${encodeURIComponent(model)}`, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } });
          const p = (await res.json()).prices?.[0];
          if (!p) throw new Error("no price");
          return { unit: String(p.unit), price: Number(p.unit_price) };
        } catch {
          falPriceCache.delete(model);
          return null;
        }
      })(),
    );
  }
  return falPriceCache.get(model)!;
}

/** USD per output second at a resolution, from fal's pricing API (token-priced models use w*h*24fps/1024 tokens per second). */
async function falPricePerSec(model: string, resolution: string): Promise<number | null> {
  const p = await falUnitPrice(model);
  if (!p) return null;
  if (p.unit === "seconds") return p.price;
  const px = resolution === "480p" ? 480 * 864 : resolution === "1080p" ? 1080 * 1920 : 720 * 1280;
  const tokensPerSec = (px * 24) / 1024;
  const per = /1m/i.test(p.unit) ? 1_000_000 : /1000|1k/i.test(p.unit) ? 1000 : 1;
  return (tokensPerSec / per) * p.price;
}

async function falVideo(model: string, prompt: string, o: VideoOpts = {}): Promise<{ url: string; usage: Usage }> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("fal.ai is not connected (set FAL_KEY)");
  if (!/^[a-z0-9][a-z0-9./-]+$/.test(model)) throw new Error("Invalid fal model");
  const headers = { Authorization: `Key ${key}`, "Content-Type": "application/json" };
  const body = falVideoBody(model, prompt, o);
  const submit = await fetch(`${FAL_QUEUE}${model}`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!submit.ok) throw new Error(falError(submit.status, await submit.text()));
  const { status_url, response_url } = await submit.json();
  if (![status_url, response_url].every((u) => typeof u === "string" && u.startsWith(FAL_QUEUE))) throw new Error("Unexpected fal status URL");
  const started = Date.now();
  for (;;) {
    if (Date.now() - started > VIDEO_TIMEOUT_MS) throw new Error("fal video timed out");
    await sleep(5000);
    const st = await fetch(status_url, { headers });
    if (!st.ok) {
      if (st.status < 500) throw new Error(falError(st.status, await st.text()));
      continue;
    }
    const s = await st.json();
    if (s.status === "COMPLETED") break;
    if (!["IN_QUEUE", "IN_PROGRESS"].includes(s.status)) throw new Error(`fal video ${String(s.status).toLowerCase()}${s.error ? `: ${String(s.error).slice(0, 200)}` : ""}`);
  }
  const res = await fetch(response_url, { headers });
  const out = await res.json();
  if (!res.ok) throw new Error(falError(res.status, JSON.stringify(out?.detail ?? out)));
  const url: string | undefined = out.video?.url ?? out.videos?.[0]?.url;
  if (!url) throw new Error("fal returned no video");
  const secs = Number(String(body.duration ?? "5").replace("s", ""));
  const rate = await falPricePerSec(model, String(body.resolution ?? "720p"));
  return { url: await downloadAsDataUrl(url), usage: { costUsd: rate ? rate * secs : 0 } };
}

type VideoSpec = { durations?: number[] | null; resolutions?: string[] | null; aspects?: string[] | null; frames?: string[] | null; pricing?: Record<string, string> | null };
export type VideoOpts = { firstFrame?: string; lastFrame?: string; seconds?: number; audio?: boolean; resolution?: string };
let videoCatalog: { at: number; specs: Map<string, VideoSpec> } | null = null;

async function openrouterVideoSpec(model: string): Promise<VideoSpec> {
  if (!videoCatalog || Date.now() - videoCatalog.at > 3_600_000) {
    const res = await fetch("https://openrouter.ai/api/v1/videos/models");
    const json = res.ok ? await res.json() : { data: [] };
    videoCatalog = {
      at: Date.now(),
      specs: new Map(
        (json.data ?? []).map((m: { id: string; supported_durations?: number[]; supported_resolutions?: string[]; supported_aspect_ratios?: string[]; supported_frame_images?: string[]; pricing_skus?: Record<string, string> }) => [
          m.id,
          { durations: m.supported_durations, resolutions: m.supported_resolutions, aspects: m.supported_aspect_ratios, frames: m.supported_frame_images, pricing: m.pricing_skus },
        ]),
      ),
    };
  }
  return videoCatalog.specs.get(model) ?? {};
}

const prefer = <T,>(options: T[] | null | undefined, wanted: T[]): T | undefined => (options?.length ? (wanted.find((w) => options.includes(w)) ?? options[0]) : undefined);
const nearest = (options: number[] | null | undefined, want: number) => (options?.length ? options.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a)) : want);

/** USD per output second from OpenRouter's pricing SKUs (null when unknown or not an OpenRouter model). */
export async function videoPricePerSec(model: string, resolution = "720p", audio = false): Promise<number | null> {
  if (providerOf(model) === "higgsfield") return pickRate(await higgsfieldRates(model), resolution)?.rate ?? null;
  if (providerOf(model) === "fal") return falPricePerSec(model, resolution);
  if (providerOf(model) === "hfmcp") return 0;
  if (providerOf(model) !== "openrouter") return null;
  const p = (await openrouterVideoSpec(model)).pricing;
  if (!p) return null;
  const a = audio ? "with_audio" : "without_audio";
  const keys = [`duration_seconds_${a}_${resolution}`, `duration_seconds_${a}`, `image_to_video_duration_seconds_${resolution}`, `duration_seconds_${resolution}`, ...(audio ? ["duration_seconds_with_audio"] : []), "duration_seconds"];
  for (const k of keys) if (p[k]) return Number(p[k]);
  const cents = p[`cents_per_video_output_second_${resolution}`];
  if (cents) return Number(cents) / 100;
  const tok = p[audio ? "video_tokens" : "video_tokens_without_audio"] ?? p.video_tokens;
  if (tok) {
    const px = resolution === "480p" ? 480 * 854 : resolution === "1080p" ? 1080 * 1920 : 720 * 1280;
    return (Number(tok) * px * 24) / 1024;
  }
  return null;
}

/** Spendable OpenRouter balance, capped by all budget scopes reported on the key. */
export async function openrouterCredits(): Promise<number | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  const auth = { Authorization: `Bearer ${key}` };
  // A loaded machine can miss an 8 s window; a slow answer must not read as "no balance". Retry once, longer.
  const get = async (path: string) => {
    for (const ms of [10_000, 25_000]) {
      const j = await fetch(`https://openrouter.ai/api/v1/${path}`, { headers: auth, signal: AbortSignal.timeout(ms) })
        .then((r) => (r.ok ? r.json() : null))
        .catch((e) => (console.error(`[openrouter] ${path} check failed`, e), null));
      if (j) return j;
    }
    return null;
  };
  const [c, k] = await Promise.all([get("credits"), get("key")]);
  const left: number[] = [];
  if (c?.data) left.push(Number(c.data.total_credits) - Number(c.data.total_usage));
  if (k?.data?.limit_remaining != null) left.push(Number(k.data.limit_remaining));
  const scopes = Array.isArray(k?.data?.budgets) ? k.data.budgets : [];
  for (const budget of [...scopes, k?.data?.effective_budget]) {
    if (budget?.remaining_usd != null) left.push(Number(budget.remaining_usd));
  }
  const limits = left.filter(Number.isFinite);
  return limits.length ? Math.min(...limits) : null;
}

/** Durations a video model accepts (from OpenRouter's catalog), for planning shot lengths. */
export async function videoDurations(model: string): Promise<number[] | null> {
  const p = providerOf(model);
  if (p === "higgsfield") return higgsfieldDurations(model);
  if (p === "fal") return falDurations(model);
  if (p === "hfmcp") return HFMCP_DURATIONS[model] ?? null;
  return p === "openrouter" ? ((await openrouterVideoSpec(model)).durations ?? null) : null;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const VIDEO_TIMEOUT_MS = 12 * 60_000;

async function downloadAsDataUrl(url: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Video download failed (${res.status})`);
  const type = res.headers.get("content-type")?.split(";")[0] || "video/mp4";
  return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
}

async function openrouterVideo(model: string, prompt: string, o: VideoOpts = {}): Promise<{ url: string; usage: Usage }> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  const auth = { Authorization: `Bearer ${key}` };
  const spec = await openrouterVideoSpec(model);
  const body = {
    model,
    prompt,
    duration: o.seconds ? nearest(spec.durations, o.seconds) : prefer(spec.durations, [6, 5, 8, 4]),
    resolution: o.resolution && spec.resolutions?.includes(o.resolution) ? o.resolution : prefer(spec.resolutions, o.resolution === "480p" ? ["480p", "512p", "540p", "720p", "768p"] : ["720p", "768p", "1080p"]),
    aspect_ratio: prefer(spec.aspects, ["9:16", "3:4", "1:1"]),
    generate_audio: o.audio ?? true,
    ...(o.firstFrame
      ? {
          frame_images: [
            { type: "image_url", image_url: { url: o.firstFrame }, frame_type: "first_frame" },
            ...(o.lastFrame && spec.frames?.includes("last_frame") ? [{ type: "image_url", image_url: { url: o.lastFrame }, frame_type: "last_frame" }] : []),
          ],
        }
      : {}),
  };
  const submit = await fetch("https://openrouter.ai/api/v1/videos", { method: "POST", headers: { ...auth, "Content-Type": "application/json", "X-Title": "GTM Engine" }, body: JSON.stringify(body) });
  if (!submit.ok) throw new Error(`OpenRouter video ${submit.status}: ${(await submit.text()).slice(0, 300)}`);
  let job = await submit.json();
  const started = Date.now();
  while (job.status !== "completed") {
    if (["failed", "cancelled", "expired"].includes(job.status)) throw new Error(`Video ${job.status}: ${JSON.stringify(job.error ?? "").slice(0, 300)}`);
    if (Date.now() - started > VIDEO_TIMEOUT_MS) throw new Error("Video generation timed out");
    await sleep(8000);
    const poll = await fetch(new URL(job.polling_url ?? `/api/v1/videos/${job.id}`, "https://openrouter.ai"), { headers: auth });
    if (poll.ok) job = await poll.json();
    else if (poll.status < 500) throw new Error(`OpenRouter video poll ${poll.status}: ${(await poll.text()).slice(0, 200)}`);
  }
  const src: string = job.unsigned_urls?.[0] ?? `https://openrouter.ai/api/v1/videos/${job.id}/content?index=0`;
  const url = await downloadAsDataUrl(src, src.startsWith("https://openrouter.ai/") ? auth : {});
  return { url, usage: { costUsd: job.usage?.cost ?? 0 } };
}

const HIGGSFIELD_ASPECTS: Record<string, string[]> = { kling: ["9:16", "1:1"], default: ["9:16", "3:4", "1:1"] };

/** "KEY_ID:KEY_SECRET" from either a single HF_API_KEY or the ID/secret pair. */
function higgsfieldCredential(): string | null {
  const id = process.env.HF_API_KEY_ID?.trim();
  const secret = process.env.HF_API_KEY_SECRET?.trim();
  if (id && secret) return `${id}:${secret}`;
  return process.env.HF_API_KEY?.trim() || null;
}

const hfEndpoint = (model: string) => {
  const e = model.replace(/^higgsfield:/, "");
  if (!/^[a-z0-9][a-z0-9./-]+$/.test(e)) throw new Error("Invalid Higgsfield model");
  return e;
};
const hfAuth = () => {
  const cred = higgsfieldCredential();
  if (!cred) throw new Error("Higgsfield is not connected (set HF_API_KEY, or HF_API_KEY_ID and HF_API_KEY_SECRET)");
  return { Authorization: `Key ${cred}` };
};
const isKling = (e: string) => e.startsWith("kling-video/");

/** Clip lengths each Higgsfield family accepts. */
export function higgsfieldDurations(model: string): number[] {
  const e = model.replace(/^higgsfield:/, "");
  return isKling(e) ? [3, 4, 5, 6, 7, 8, 9, 10] : [4, 5, 6, 7, 8, 9, 10, 11, 12];
}

/** Turns Higgsfield error bodies into a message a Studio user can act on. */
export function higgsfieldError(status: number, body: string): string {
  if (/not_enough_credits/.test(body)) return "Higgsfield balance is empty. Add funds at console.higgsfield.ai (Billing), then retry. Nothing was charged.";
  if (status === 401) return "Higgsfield rejected the API key (401). Check HF_API_KEY on the Connections page.";
  if ([404, 423, 503].includes(status)) return `This Higgsfield model isn't available to your account right now (${status}). Pick another video model.`;
  return `Higgsfield ${status}: ${body.slice(0, 300)}`;
}

/** "480p: $0.0804; 720p: $0.1735." -> { "480p": 0.0804, "720p": 0.1735 } */
export function parseHiggsfieldRates(text: string): Record<string, number> {
  return Object.fromEntries([...text.matchAll(/(\d+p|4K): \$(\d+(?:\.\d+)?)/g)].map((m) => [m[1], Number(m[2])]));
}

const hfPriceCache = new Map<string, Promise<Record<string, number> | null>>();
/** Per-second USD rates by resolution, from Higgsfield's estimate endpoint (no charge). */
function higgsfieldRates(model: string): Promise<Record<string, number> | null> {
  const e = model.replace(/^higgsfield:/, "").replace("/text-to-video", "/image-to-video");
  if (!hfPriceCache.has(e)) {
    hfPriceCache.set(
      e,
      (async () => {
        try {
          let res: Response | null = null;
          for (let i = 0; i < 3 && (!res || res.status === 429); i++) {
            if (i) await sleep(1500 * i);
            res = await fetch(`https://api.higgsfield.ai/estimate/${hfEndpoint(e)}`, {
            method: "POST",
            headers: { ...hfAuth(), "Content-Type": "application/json" },
              body: JSON.stringify({ prompt: "estimate", image_url: "https://example.com/a.jpg", duration: 5 }),
            });
          }
          const j = await res!.json();
          const text = String(j.pricing_description ?? "");
          const rates = parseHiggsfieldRates(text);
          if (j.usd && !Object.keys(rates).length) rates.any = Number(j.usd) / 5;
          if (!Object.keys(rates).length) throw new Error("no rates");
          return rates;
        } catch {
          hfPriceCache.delete(e);
          return null;
        }
      })(),
    );
  }
  return hfPriceCache.get(e)!;
}

export function pickRate(rates: Record<string, number> | null, resolution: string): { rate: number; resolution: string } | null {
  if (!rates) return null;
  if (rates[resolution] != null) return { rate: rates[resolution], resolution };
  const order = ["480p", "720p", "1080p", "4K", "any"];
  const want = order.indexOf(resolution);
  const avail = order.filter((r) => rates[r] != null);
  const up = avail.find((r) => order.indexOf(r) >= want) ?? avail[avail.length - 1];
  return up ? { rate: rates[up], resolution: up } : null;
}

async function higgsfieldUpload(dataUrl: string, auth: Record<string, string>): Promise<string> {
  if (/^https:\/\//.test(dataUrl)) return dataUrl;
  const m = /^data:([^;]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!m) throw new Error("Higgsfield needs the first frame as an image");
  const type = m[1] === "image/jpg" ? "image/jpeg" : m[1];
  const res = await fetch("https://api.higgsfield.ai/files/generate-upload-url", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ content_type: type }) });
  if (!res.ok) throw new Error(higgsfieldError(res.status, await res.text()));
  const u: { public_url: string; upload_url: string; upload_headers?: Record<string, string> } = await res.json();
  const put = await fetch(u.upload_url, { method: "PUT", headers: u.upload_headers ?? { "Content-Type": type }, body: Buffer.from(m[2], "base64") });
  if (!put.ok) throw new Error(`Higgsfield upload failed (${put.status})`);
  return u.public_url;
}

/** Request body for a Higgsfield video model; exported for tests. */
export function higgsfieldBody(endpoint: string, prompt: string, o: VideoOpts, imageUrl?: string) {
  const kling = isKling(endpoint);
  const durs = higgsfieldDurations(endpoint);
  const body: Record<string, unknown> = {
    prompt: prompt.slice(0, kling ? 2500 : 4000),
    duration: nearest(durs, o.seconds ?? 5),
    aspect_ratio: (kling ? HIGGSFIELD_ASPECTS.kling : HIGGSFIELD_ASPECTS.default)[0],
  };
  if (imageUrl) body.image_url = imageUrl;
  if (kling) body.sound = o.audio === false ? "off" : "on";
  else Object.assign(body, { resolution: ["480p", "720p", "1080p"].includes(o.resolution ?? "") ? o.resolution : "480p", generate_audio: o.audio ?? true });
  return body;
}

async function higgsfieldVideo(model: string, prompt: string, o: VideoOpts = {}): Promise<{ url: string; usage: Usage }> {
  const auth = hfAuth();
  let endpoint = hfEndpoint(model);
  if (o.firstFrame) endpoint = endpoint.replace("/text-to-video", "/image-to-video");
  const imageUrl = o.firstFrame ? await higgsfieldUpload(o.firstFrame, auth) : undefined;
  const body = higgsfieldBody(endpoint, prompt, o, imageUrl);
  const submit = await fetch(`https://api.higgsfield.ai/${endpoint}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(body),
  });
  if (!submit.ok) throw new Error(higgsfieldError(submit.status, await submit.text()));
  let job = await submit.json();
  const statusUrl: string = job.status_url ?? `https://api.higgsfield.ai/requests/${job.request_id}/status`;
  if (!statusUrl.startsWith("https://api.higgsfield.ai/")) throw new Error("Unexpected Higgsfield status URL");
  const started = Date.now();
  while (job.status !== "completed") {
    if (["failed", "nsfw", "canceled", "cancelled"].includes(job.status)) throw new Error(`Higgsfield ${job.status}${job.error ? `: ${String(job.error).slice(0, 200)}` : ""} (not charged)`);
    if (Date.now() - started > VIDEO_TIMEOUT_MS) throw new Error("Higgsfield video timed out");
    await sleep(8000);
    const poll = await fetch(statusUrl, { headers: auth });
    if (poll.ok) job = await poll.json();
    else if (poll.status < 500) throw new Error(higgsfieldError(poll.status, await poll.text()));
  }
  const out: string | undefined = job.video?.url ?? job.videos?.[0]?.url;
  if (!out) throw new Error("Higgsfield returned no video");
  const r = pickRate(await higgsfieldRates(endpoint), String(body.resolution ?? (isKling(endpoint) ? "720p" : "480p")));
  return { url: await downloadAsDataUrl(out), usage: { costUsd: r ? r.rate * Number(body.duration) : 0 } };
}

const HFMCP_DURATIONS: Record<string, number[]> = { "hfmcp:seedance1_5": [4, 8, 12], "hfmcp:kling3_0": [5, 10] };

/** Higgsfield MCP spends subscription credits, so the USD cost is 0 and credits are reported separately. */
async function hfmcpVideo(model: string, prompt: string, o: VideoOpts): Promise<{ url: string; usage: Usage }> {
  const { higgsfieldMcpVideo } = await import("./higgsfield-mcp");
  const r = await higgsfieldMcpVideo(model.replace(/^hfmcp:/, ""), prompt, { firstFrame: o.firstFrame, seconds: o.seconds, resolution: o.resolution });
  return { url: await downloadAsDataUrl(r.url), usage: { costUsd: 0, credits: r.credits ?? undefined } };
}

export async function generateVideo(model: string, prompt: string, opts?: string | VideoOpts): Promise<{ url: string; usage: Usage }> {
  const o: VideoOpts = typeof opts === "string" ? { firstFrame: opts } : (opts ?? {});
  const provider = providerOf(model);
  if (provider === "fal") return falVideo(model, prompt, o);
  if (provider === "higgsfield") return higgsfieldVideo(model, prompt, o);
  if (provider === "hfmcp") return hfmcpVideo(model, prompt, o);
  return openrouterVideo(model, prompt, o);
}

async function falRun<T>(endpoint: string, input: Record<string, unknown>): Promise<T> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY is not set");
  const headers = { Authorization: `Key ${key}`, "Content-Type": "application/json" };
  const submit = await fetch(`https://queue.fal.run/${endpoint}`, { method: "POST", headers, body: JSON.stringify(input) });
  if (!submit.ok) throw new Error(`fal ${submit.status}: ${(await submit.text()).slice(0, 300)}`);
  const { status_url, response_url } = await submit.json();
  if (!String(status_url).startsWith("https://queue.fal.run/")) throw new Error("Unexpected fal status URL");
  const started = Date.now();
  while (Date.now() - started < VIDEO_TIMEOUT_MS) {
    await sleep(3000);
    const s = await (await fetch(status_url, { headers })).json();
    if (s.status === "COMPLETED") return (await fetch(response_url, { headers })).json();
    if (s.status === "FAILED" || s.status === "ERROR") throw new Error(`fal ${endpoint} failed`);
  }
  throw new Error(`fal ${endpoint} timed out`);
}

export const audioConfigured = () => !!process.env.FAL_KEY;
const VOICES = ["Rachel", "Aria", "Sarah", "Laura", "Charlotte", "Jessica", "Lily", "Roger", "Charlie", "George", "Callum", "Liam", "Will", "Eric", "Chris", "Brian", "Daniel"];

/** ElevenLabs voiceover via fal ($0.05 per 1k characters). */
/** Speech-to-text via fal Whisper; returns the transcript and timed segments. */
export async function transcribe(audio: string): Promise<{ text: string; chunks: { start: number; end: number; text: string }[]; usage: Usage }> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("fal.ai is not connected (set FAL_KEY)");
  const headers = { Authorization: `Key ${key}`, "Content-Type": "application/json" };
  const submit = await fetch(`${FAL_QUEUE}fal-ai/whisper`, { method: "POST", headers, body: JSON.stringify({ audio_url: audio, task: "transcribe", language: "en", chunk_level: "segment" }) });
  if (!submit.ok) throw new Error(falError(submit.status, await submit.text()));
  const { status_url, response_url } = await submit.json();
  if (![status_url, response_url].every((u) => typeof u === "string" && u.startsWith(FAL_QUEUE))) throw new Error("Unexpected fal status URL");
  const started = Date.now();
  for (;;) {
    if (Date.now() - started > 120_000) throw new Error("Transcription timed out");
    await sleep(1500);
    const st = await fetch(status_url, { headers });
    if (!st.ok) continue;
    const j = await st.json();
    if (j.status === "COMPLETED") break;
    if (!["IN_QUEUE", "IN_PROGRESS"].includes(j.status)) throw new Error(`Transcription ${String(j.status).toLowerCase()}`);
  }
  const res = await fetch(response_url, { headers });
  const out = await res.json();
  if (!res.ok) throw new Error(falError(res.status, JSON.stringify(out?.detail ?? out)));
  const chunks = ((out.chunks ?? []) as { timestamp: [number, number | null]; text: string }[]).map((c) => ({ start: Number(c.timestamp?.[0]) || 0, end: Number(c.timestamp?.[1] ?? c.timestamp?.[0]) || 0, text: String(c.text ?? "").trim() }));
  return { text: String(out.text ?? "").trim(), chunks, usage: { costUsd: 0.002 } };
}

/**
 * Text as the TTS should read it. All-caps brand words are read as mangled acronyms or guesses ("OLIPOP" came back
 * "Olapop" twice, run_8a9c7c9db627), so they go to the voice as one capitalised word. Known acronyms stay as they are.
 */
const ACRONYMS = new Set(["USA", "NASA", "FAQ", "SALE", "FREE", "CEO", "DIY", "ASAP", "HTML", "SPF"]);
export function speakable(text: string) {
  return text.replace(/\b[A-Z]{4,}\b/g, (w) => (ACRONYMS.has(w) ? w : w[0] + w.slice(1).toLowerCase()));
}

export async function voiceover(text: string, voice = "Rachel"): Promise<{ url: string; usage: Usage }> {
  const out = await falRun<{ audio?: { url: string } }>("fal-ai/elevenlabs/tts/turbo-v2.5", { text: speakable(text), voice: VOICES.includes(voice) ? voice : "Rachel" });
  if (!out.audio?.url) throw new Error("Voiceover returned no audio");
  return { url: await downloadAsDataUrl(out.audio.url), usage: { costUsd: (text.length / 1000) * 0.05 } };
}

/** Instrumental music bed via fal ElevenLabs Music ($0.60 per started minute). */
export async function musicBed(prompt: string, seconds: number): Promise<{ url: string; usage: Usage }> {
  const ms = Math.max(3000, Math.min(120_000, Math.round(seconds * 1000)));
  const out = await falRun<{ audio?: { url: string } }>("fal-ai/elevenlabs/music", { prompt, music_length_ms: ms, force_instrumental: true });
  if (!out.audio?.url) throw new Error("Music returned no audio");
  return { url: await downloadAsDataUrl(out.audio.url), usage: { costUsd: Math.ceil(ms / 60_000) * 0.6 } };
}

export function aiConfigured() {
  return !!process.env.OPENROUTER_API_KEY;
}
