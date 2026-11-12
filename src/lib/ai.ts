import { providerOf } from "./models";

const OR_URL = "https://openrouter.ai/api/v1/chat/completions";

export type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type Msg = { role: "system" | "user" | "assistant"; content: string | Part[] };

export interface Usage {
  costUsd: number;
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
  const json = await openrouter({ model, messages, response_format: { type: "json_object" } });
  const text: string = json.choices?.[0]?.message?.content ?? "";
  return { data: extractJSON(text) as T, usage: { costUsd: json.usage?.cost ?? 0 } };
}

export async function generateImage(model: string, prompt: string, refs: string[] = []): Promise<{ url: string; usage: Usage }> {
  const content: Part[] = [{ type: "text", text: prompt }, ...refs.map((url) => ({ type: "image_url" as const, image_url: { url } }))];
  const json = await openrouter({ model, modalities: ["image", "text"], messages: [{ role: "user", content }] });
  const url: string | undefined = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) throw new Error("Image model returned no image");
  return { url, usage: { costUsd: json.usage?.cost ?? 0 } };
}

async function falVideo(model: string, prompt: string): Promise<string> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY is not set");
  const headers = { Authorization: `Key ${key}`, "Content-Type": "application/json" };
  const submit = await fetch(`https://queue.fal.run/${model}`, { method: "POST", headers, body: JSON.stringify({ prompt }) });
  if (!submit.ok) throw new Error(`fal ${submit.status}: ${(await submit.text()).slice(0, 300)}`);
  const { status_url, response_url } = await submit.json();
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const s = await (await fetch(status_url, { headers })).json();
    if (s.status === "COMPLETED") {
      const out = await (await fetch(response_url, { headers })).json();
      return out.video?.url ?? out.videos?.[0]?.url;
    }
    if (s.status === "FAILED" || s.status === "ERROR") throw new Error("fal job failed");
  }
  throw new Error("fal job timed out");
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
export const nearest = (options: number[] | null | undefined, want: number) => (options?.length ? options.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a)) : want);

/** USD per output second from OpenRouter's pricing SKUs (null when unknown or not an OpenRouter model). */
export async function videoPricePerSec(model: string, resolution = "720p", audio = false): Promise<number | null> {
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

/** Spendable OpenRouter balance: account credits left, capped by the key's own limit. */
export async function openrouterCredits(): Promise<number | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  const auth = { Authorization: `Bearer ${key}` };
  const [c, k] = await Promise.all([
    fetch("https://openrouter.ai/api/v1/credits", { headers: auth }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch("https://openrouter.ai/api/v1/key", { headers: auth }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  const left: number[] = [];
  if (c?.data) left.push(Number(c.data.total_credits) - Number(c.data.total_usage));
  if (k?.data?.limit_remaining != null) left.push(Number(k.data.limit_remaining));
  return left.length ? Math.min(...left) : null;
}

/** Durations a video model accepts (from OpenRouter's catalog), for planning shot lengths. */
export async function videoDurations(model: string): Promise<number[] | null> {
  return providerOf(model) === "openrouter" ? ((await openrouterVideoSpec(model)).durations ?? null) : null;
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
    resolution: o.resolution && spec.resolutions?.includes(o.resolution) ? o.resolution : prefer(spec.resolutions, ["720p", "768p", "1080p"]),
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
export function higgsfieldCredential(): string | null {
  const id = process.env.HF_API_KEY_ID?.trim();
  const secret = process.env.HF_API_KEY_SECRET?.trim();
  if (id && secret) return `${id}:${secret}`;
  return process.env.HF_API_KEY?.trim() || null;
}

async function higgsfieldVideo(model: string, prompt: string): Promise<{ url: string; usage: Usage }> {
  const cred = higgsfieldCredential();
  if (!cred) throw new Error("Higgsfield is not connected (set HF_API_KEY, or HF_API_KEY_ID and HF_API_KEY_SECRET)");
  const endpoint = model.replace(/^higgsfield:/, "");
  if (!/^[a-z0-9][a-z0-9./-]+$/.test(endpoint)) throw new Error("Invalid Higgsfield model");
  const auth = { Authorization: `Key ${cred}` };
  const kling = endpoint.startsWith("kling-video/");
  const body: Record<string, unknown> = { prompt: prompt.slice(0, kling ? 2500 : 4000), duration: 5, aspect_ratio: (kling ? HIGGSFIELD_ASPECTS.kling : HIGGSFIELD_ASPECTS.default)[0] };
  if (kling) body.sound = "on";
  else Object.assign(body, { resolution: "720p", generate_audio: true });
  const submit = await fetch(`https://api.higgsfield.ai/${endpoint}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(body),
  });
  if (!submit.ok) throw new Error(`Higgsfield ${submit.status}: ${(await submit.text()).slice(0, 300)}`);
  let job = await submit.json();
  const statusUrl: string = job.status_url ?? `https://api.higgsfield.ai/requests/${job.request_id}/status`;
  if (!statusUrl.startsWith("https://api.higgsfield.ai/")) throw new Error("Unexpected Higgsfield status URL");
  const started = Date.now();
  while (job.status !== "completed") {
    if (["failed", "nsfw", "canceled", "cancelled"].includes(job.status)) throw new Error(`Higgsfield ${job.status}${job.error ? `: ${String(job.error).slice(0, 200)}` : ""}`);
    if (Date.now() - started > VIDEO_TIMEOUT_MS) throw new Error("Higgsfield video timed out");
    await sleep(8000);
    const poll = await fetch(statusUrl, { headers: auth });
    if (poll.ok) job = await poll.json();
    else if (poll.status < 500) throw new Error(`Higgsfield status ${poll.status}: ${(await poll.text()).slice(0, 200)}`);
  }
  const out: string | undefined = job.video?.url ?? job.videos?.[0]?.url;
  if (!out) throw new Error("Higgsfield returned no video");
  return { url: await downloadAsDataUrl(out), usage: { costUsd: 0 } };
}

export async function generateVideo(model: string, prompt: string, opts?: string | VideoOpts): Promise<{ url: string; usage: Usage }> {
  const o: VideoOpts = typeof opts === "string" ? { firstFrame: opts } : (opts ?? {});
  const provider = providerOf(model);
  if (provider === "fal") return { url: await falVideo(model, prompt), usage: { costUsd: 0 } };
  if (provider === "higgsfield") return higgsfieldVideo(model, prompt);
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
export const VOICES = ["Rachel", "Aria", "Sarah", "Laura", "Charlotte", "Jessica", "Lily", "Roger", "Charlie", "George", "Callum", "Liam", "Will", "Eric", "Chris", "Brian", "Daniel"];

/** ElevenLabs voiceover via fal ($0.05 per 1k characters). */
export async function voiceover(text: string, voice = "Rachel"): Promise<{ url: string; usage: Usage }> {
  const out = await falRun<{ audio?: { url: string } }>("fal-ai/elevenlabs/tts/turbo-v2.5", { text, voice: VOICES.includes(voice) ? voice : "Rachel" });
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
