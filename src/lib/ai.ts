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

export async function generateVideo(model: string, prompt: string): Promise<{ url: string; usage: Usage }> {
  const provider = providerOf(model);
  if (provider === "fal") return { url: await falVideo(model, prompt), usage: { costUsd: 0 } };
  if (provider === "higgsfield") throw new Error("Higgsfield adapter needs HIGGSFIELD_API_KEY and API docs; not configured yet");
  const json = await openrouter({ model, modalities: ["video", "text"], messages: [{ role: "user", content: prompt }] });
  const msg = json.choices?.[0]?.message;
  const url: string | undefined = msg?.videos?.[0]?.video_url?.url ?? msg?.videos?.[0]?.url;
  if (!url) throw new Error("Video model returned no video");
  return { url, usage: { costUsd: json.usage?.cost ?? 0 } };
}

export function aiConfigured() {
  return !!process.env.OPENROUTER_API_KEY;
}
