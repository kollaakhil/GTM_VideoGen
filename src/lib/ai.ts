import { providerOf } from "./models";

const OR_URL = "https://openrouter.ai/api/v1/chat/completions";

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type Msg = { role: "system" | "user" | "assistant"; content: string | Part[] };

export interface Usage {
  costUsd: number;
}

async function openrouter(body: Record<string, unknown>) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  const res = await fetch(OR_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Title": "GTM Engine",
    },
    body: JSON.stringify({ ...body, usage: { include: true } }),
  });
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

type VideoSpec = { durations?: number[] | null; resolutions?: string[] | null; aspects?: string[] | null };
let videoCatalog: { at: number; specs: Map<string, VideoSpec> } | null = null;

async function openrouterVideoSpec(model: string): Promise<VideoSpec> {
  if (!videoCatalog || Date.now() - videoCatalog.at > 3_600_000) {
    const res = await fetch("https://openrouter.ai/api/v1/videos/models");
    const json = res.ok ? await res.json() : { data: [] };
    videoCatalog = {
      at: Date.now(),
      specs: new Map(
        (json.data ?? []).map((m: { id: string; supported_durations?: number[]; supported_resolutions?: string[]; supported_aspect_ratios?: string[] }) => [
          m.id,
          { durations: m.supported_durations, resolutions: m.supported_resolutions, aspects: m.supported_aspect_ratios },
        ]),
      ),
    };
  }
  return videoCatalog.specs.get(model) ?? {};
}

const prefer = <T,>(options: T[] | null | undefined, wanted: T[]): T | undefined => (options?.length ? (wanted.find((w) => options.includes(w)) ?? options[0]) : undefined);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const VIDEO_TIMEOUT_MS = 12 * 60_000;

async function downloadAsDataUrl(url: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Video download failed (${res.status})`);
  const type = res.headers.get("content-type")?.split(";")[0] || "video/mp4";
  return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
}

async function openrouterVideo(model: string, prompt: string, firstFrame?: string): Promise<{ url: string; usage: Usage }> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  const auth = { Authorization: `Bearer ${key}` };
  const spec = await openrouterVideoSpec(model);
  const body = {
    model,
    prompt,
    duration: prefer(spec.durations, [6, 5, 8, 4]),
    resolution: prefer(spec.resolutions, ["720p", "768p", "1080p"]),
    aspect_ratio: prefer(spec.aspects, ["9:16", "3:4", "1:1"]),
    generate_audio: true,
    ...(firstFrame ? { frame_images: [{ type: "image_url", image_url: { url: firstFrame }, frame_type: "first_frame" }] } : {}),
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

async function higgsfieldVideo(model: string, prompt: string): Promise<{ url: string; usage: Usage }> {
  const id = process.env.HF_API_KEY_ID;
  const secret = process.env.HF_API_KEY_SECRET;
  if (!id || !secret) throw new Error("Higgsfield is not connected (set HF_API_KEY_ID and HF_API_KEY_SECRET)");
  const endpoint = model.replace(/^higgsfield:/, "");
  if (!/^[a-z0-9][a-z0-9./-]+$/.test(endpoint)) throw new Error("Invalid Higgsfield model");
  const auth = { Authorization: `Key ${id}:${secret}` };
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

export async function generateVideo(model: string, prompt: string, firstFrame?: string): Promise<{ url: string; usage: Usage }> {
  const provider = providerOf(model);
  if (provider === "fal") return { url: await falVideo(model, prompt), usage: { costUsd: 0 } };
  if (provider === "higgsfield") return higgsfieldVideo(model, prompt);
  return openrouterVideo(model, prompt, firstFrame);
}

export function aiConfigured() {
  return !!process.env.OPENROUTER_API_KEY;
}
