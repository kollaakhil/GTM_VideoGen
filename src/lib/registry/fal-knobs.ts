/**
 * fal.ai's endpoints take different request fields (duration as 5, "5" or "5s"; num_frames instead of duration; the image
 * under image_url or start_image_url…). fal publishes an OpenAPI schema per endpoint, so instead of hand-writing a body
 * per model we derive the knobs from that schema (`deriveKnobs`), snapshot them (`fal-snapshot.ts`) and build bodies from
 * the snapshot (`buildFalBody`). `scripts/verify-models.mjs --schemas` re-derives them live and reports drift.
 * Pure functions, no imports, so Node can run them directly.
 */
export interface FalKnobs {
  /** The field that carries the prompt (absent for image-only endpoints such as TRELLIS). */
  text?: string;
  image?: string;
  imageArray?: string;
  end?: string;
  /** Duration field: `int` (5), `str` ("5"), `strs` ("5s"); unit is seconds or milliseconds. */
  dur?: { key: string; as: "int" | "str" | "strs"; ms?: boolean; values?: number[]; min?: number; max?: number; auto?: boolean };
  frames?: { key: string; min: number; max: number; def: number; fpsKey?: string; fpsDef?: number };
  res?: { key: string; values: string[] };
  aspect?: { key: string; values?: string[] };
  imageSize?: string[];
  neg?: string;
  audio?: string;
  /** Required fields we do not otherwise fill, with the schema's default. */
  extra?: Record<string, unknown>;
}

type Prop = Record<string, unknown>;
const TEXT_KEYS = ["prompt", "text", "tags"];
const IMAGE_KEYS = ["image_url", "start_image_url", "input_image_url"];
const END_KEYS = ["end_image_url", "tail_image_url"];
const DUR_KEYS = ["duration", "seconds_total", "duration_seconds", "music_length_ms", "length_ms", "duration_ms"];
const NEG_KEYS = ["negative_prompt"];
const AUDIO_KEYS = ["generate_audio", "audio", "generate_audio_switch"];

function resolve(schemas: Record<string, Prop>, p: Prop | undefined): Prop {
  let q: Prop = p ?? {};
  for (let i = 0; i < 4; i++) {
    if (typeof q.$ref === "string") q = schemas[String(q.$ref).split("/").pop() as string] ?? {};
    else if (Array.isArray(q.anyOf)) q = (q.anyOf as Prop[]).map((x) => (typeof x.$ref === "string" ? (schemas[String(x.$ref).split("/").pop() as string] ?? x) : x)).find((x) => x.type !== "null") ?? {};
    else if (Array.isArray(q.allOf)) q = (q.allOf as Prop[])[0] ?? {};
    else break;
  }
  return q;
}

/** Derives the request knobs from an endpoint's OpenAPI document (fal.ai/api/openapi/queue/openapi.json?endpoint_id=…). */
export function deriveKnobs(openapi: { components?: { schemas?: Record<string, Prop> } }): FalKnobs | null {
  const schemas = (openapi.components?.schemas ?? {}) as Record<string, Prop>;
  const name = Object.keys(schemas).find((k) => k.endsWith("Input"));
  const input = name ? schemas[name] : undefined;
  const props = (input?.properties ?? {}) as Record<string, Prop>;
  if (!input) return null;
  const has = (k: string) => k in props;
  const text = TEXT_KEYS.find(has);
  const k: FalKnobs = text ? { text } : {};
  const image = IMAGE_KEYS.find(has);
  if (image) k.image = image;
  if (has("image_urls")) k.imageArray = "image_urls";
  const end = END_KEYS.find(has);
  if (end) k.end = end;
  const dk = DUR_KEYS.find(has);
  if (dk) {
    const d = resolve(schemas, props[dk]);
    const en = (d.enum as (string | number)[] | undefined) ?? [];
    const nums = en.map((v) => parseFloat(String(v))).filter((v) => Number.isFinite(v));
    const auto = en.some((v) => v === "auto");
    const strs = en.some((v) => typeof v === "string" && /s$/.test(v) && v !== "auto");
    const str = d.type === "string" && !strs;
    k.dur = {
      key: dk,
      as: strs ? "strs" : str ? "str" : "int",
      ...(dk.endsWith("_ms") ? { ms: true } : {}),
      ...(nums.length ? { values: nums } : {}),
      ...(typeof d.minimum === "number" ? { min: d.minimum } : {}),
      ...(typeof d.maximum === "number" ? { max: d.maximum } : {}),
      ...(auto ? { auto: true } : {}),
    };
  }
  if (has("num_frames") && !k.dur) {
    const f = resolve(schemas, props.num_frames);
    const fpsKey = has("frames_per_second") ? "frames_per_second" : has("fps") ? "fps" : undefined;
    const fp = fpsKey ? resolve(schemas, props[fpsKey]) : undefined;
    k.frames = { key: "num_frames", min: Number(f.minimum ?? 1), max: Number(f.maximum ?? 241), def: Number(f.default ?? 81), ...(fpsKey ? { fpsKey } : {}), ...(typeof fp?.default === "number" ? { fpsDef: fp.default } : {}) };
  }
  if (has("resolution")) {
    const r = resolve(schemas, props.resolution);
    if (Array.isArray(r.enum)) k.res = { key: "resolution", values: (r.enum as unknown[]).map(String) };
  }
  if (has("aspect_ratio")) {
    const a = resolve(schemas, props.aspect_ratio);
    k.aspect = { key: "aspect_ratio", ...(Array.isArray(a.enum) ? { values: (a.enum as unknown[]).map(String) } : {}) };
  }
  if (has("image_size")) {
    const s = resolve(schemas, props.image_size);
    if (Array.isArray(s.enum)) k.imageSize = (s.enum as unknown[]).map(String);
  }
  const neg = NEG_KEYS.find(has);
  if (neg) k.neg = neg;
  const audio = AUDIO_KEYS.find((a) => has(a) && resolve(schemas, props[a]).type === "boolean");
  if (audio) k.audio = audio;
  const covered = new Set([text, image, end, dk, "image_urls", "num_frames", "resolution", "aspect_ratio", "image_size", neg, audio]);
  const extra: Record<string, unknown> = {};
  for (const r of (input.required as string[] | undefined) ?? []) {
    if (covered.has(r)) continue;
    const d = resolve(schemas, props[r]).default;
    if (d !== undefined) extra[r] = d;
  }
  if (Object.keys(extra).length) k.extra = extra;
  return k;
}

export interface FalCall {
  firstFrame?: string;
  lastFrame?: string;
  refs?: string[];
  seconds?: number;
  resolution?: string;
  aspect?: string;
  audio?: boolean;
  negative?: string;
  /** Model family hint for frame-count rules (wan: 4n+1, ltx: 8n+1). */
  frameRule?: "wan" | "ltx";
}

const near = (opts: number[], want: number) => opts.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));

/** Seconds to the value this endpoint accepts (nearest allowed, else clamped to its range). */
export function pickSeconds(k: FalKnobs, want: number): number | undefined {
  const d = k.dur;
  if (!d) return undefined;
  if (d.values?.length) return near(d.values, want);
  return Math.min(d.max ?? Infinity, Math.max(d.min ?? 0, Math.round(want)));
}

export function pickResolution(values: string[], want?: string): string {
  const lower = values.map((v) => v.toLowerCase());
  const i = want ? lower.indexOf(want.toLowerCase()) : -1;
  if (i >= 0) return values[i];
  const j = lower.indexOf("720p");
  return values[j >= 0 ? j : 0];
}

/** Request body for any fal endpoint with derived knobs. Unknown knobs are never sent. */
export function buildFalBody(k: FalKnobs, prompt: string, c: FalCall = {}): Record<string, unknown> {
  const body: Record<string, unknown> = { ...(k.extra ?? {}) };
  if (k.text) body[k.text] = prompt.slice(0, k.text === "tags" ? 600 : 2500);
  if (k.image && c.firstFrame) body[k.image] = c.firstFrame;
  if (k.imageArray && c.refs?.length) body[k.imageArray] = c.refs;
  if (k.end && c.lastFrame) body[k.end] = c.lastFrame;
  if (k.dur && c.seconds) {
    const s = pickSeconds(k, c.seconds) as number;
    body[k.dur.key] = k.dur.ms ? Math.round(s * 1000) : k.dur.as === "strs" ? `${s}s` : k.dur.as === "str" ? String(s) : s;
  } else if (k.frames && c.seconds) {
    const fps = k.frames.fpsDef ?? (c.frameRule === "wan" ? 16 : 24);
    const step = c.frameRule === "wan" ? 4 : c.frameRule === "ltx" ? 8 : 1;
    const raw = Math.round(c.seconds * fps);
    const n = step > 1 ? Math.round((raw - 1) / step) * step + 1 : raw;
    body[k.frames.key] = Math.min(k.frames.max, Math.max(k.frames.min, n));
    if (k.frames.fpsKey) body[k.frames.fpsKey] = fps;
  }
  if (k.res) body[k.res.key] = pickResolution(k.res.values, c.resolution);
  if (k.aspect && c.aspect) {
    const v = k.aspect.values;
    if (!v) body[k.aspect.key] = c.aspect;
    else if (v.includes(c.aspect)) body[k.aspect.key] = c.aspect;
  }
  if (k.imageSize && c.aspect === "9:16") {
    const sz = k.imageSize.find((s) => s === "portrait_16_9") ?? k.imageSize.find((s) => /portrait/.test(s));
    if (sz) body.image_size = sz;
  }
  if (k.neg && c.negative) body[k.neg] = c.negative.slice(0, 600);
  if (k.audio) body[k.audio] = c.audio ?? false;
  return body;
}
