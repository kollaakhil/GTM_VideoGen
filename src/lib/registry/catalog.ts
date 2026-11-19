import type { Caps, Cost, Family, ModelEntry, RegProvider, Stage, Verify } from "./types.ts";

/**
 * THE place models are declared. Everything else (pickers, Auto routing, adapters, legacy `MODELS`) reads this list.
 * To add a model: add one entry here, run `node scripts/verify-models.mjs`, and (for fal) `--write-snapshot`.
 *
 * Verification (2026-11-19): `verify.source` says which provider list the id was checked against. OpenRouter, fal and the
 * Hugging Face router publish free, key-less lists that `scripts/verify-models.mjs` re-checks. Higgsfield's MCP list needs
 * the account, so it is snapshotted below. Costs are `estimate` unless `basis: "live"`; they only feed pre-flight totals.
 */
export const VERIFIED_AT = "2026-11-19";

/** Higgsfield MCP `models_explore` ids seen on VERIFIED_AT (read-only call on the connected account). */
export const HIGGSFIELD_MCP_IDS = {
  video: ["cinematic_studio_3_0", "cinematic_studio_video_v2", "cinematic_studio_3_5", "cinematic_studio_video_4_0", "flux_3_video", "grok_video_v15", "grok_video_v15_lite", "minimax_h3", "minimax_h3_max", "wan2_6", "wan2_7", "wan3_0", "wan3_0_prime", "seedance_2_0", "seedance_2_5", "kling2_6", "kling3_0", "kling3_0_turbo", "kling4_0", "kling_4_0_flash", "gemini_omni_flash_1_1", "gemini_omni_flash_1_2", "veo3_1", "veo3_1_lite", "happy_horse_video"],
  image: ["soul_2", "gpt_image_2", "gpt_image_2_5", "gpt_image_2_6", "nano_banana_pro", "nano_banana_2", "nano_banana_2_1", "seedream_v5_pro", "flux_2", "flux_3_image", "grok_image_2_0", "ideogram_4_5", "recraft_v4_1", "z_image"],
  audio: ["seed_audio", "qwen_audio_tts", "text2speech_v2"],
  "3d": ["image_to_3d", "meshy_image_to_3d", "tripo_h3_1_image_to_3d", "hunyuan3d_v3_image_to_3d", "hunyuan3d_v3_1_text_to_3d", "meshy_v6_text_to_3d", "meshy_v7_image_to_3d"],
} as const;

const FAL = "FAL_KEY";
const OR = "OPENROUTER_API_KEY";
const per = (usd: number, unit: Cost["unit"] = "per_sec", basis: Cost["basis"] = "estimate"): Cost => ({ unit, usd, basis });
const mtok = (usd: number, usdOut: number): Cost => ({ unit: "per_mtok", usd, usdOut, basis: "live" });
const FREE: Cost = { unit: "free", usd: 0, basis: "free" };
const credits: Cost = { unit: "credits", usd: 0, basis: "estimate" };

type Extra = Partial<Pick<ModelEntry, "fal" | "note" | "runnable" | "verify">>;
const E = (id: string, label: string, provider: RegProvider, stages: Stage[], family: Family, caps: Caps, cost: Cost, env: string | null, verify: Verify, x: Extra = {}): ModelEntry => ({
  id, label, provider, stages, family, caps, cost, env, verify, runnable: x.runnable ?? true, ...(x.fal ? { fal: x.fal } : {}), ...(x.note ? { note: x.note } : {}),
});

/** OpenRouter chat models. `vision` also lists them as QA judges. */
const llm = (id: string, label: string, family: Family, usd: number, out: number, o: { vision?: boolean; open?: boolean; stages?: Stage[]; note?: string } = {}) =>
  E(id, label, "openrouter", o.stages ?? (o.vision ? ["research", "script", "enhancer", "qa"] : ["research", "script", "enhancer"]), family, { vision: !!o.vision, openSource: o.open }, mtok(usd, out), OR, { source: "openrouter" }, { note: o.note });

/** Hugging Face router chat models (open weights served by Inference Providers). */
const hf = (repo: string, label: string, usd: number, out: number, vision = false) =>
  E(`hf:${repo}`, label, "huggingface", vision ? ["research", "script", "enhancer", "qa"] : ["research", "script", "enhancer"], "open-llm", { vision, openSource: true, hfRepo: repo }, { unit: "per_mtok", usd, usdOut: out, basis: "estimate" }, "HF_TOKEN", { source: "huggingface-router", lookup: repo });

const orImage = (id: string, label: string, usd: number, out: number, note?: string) =>
  E(id, label, "openrouter", ["image"], id.startsWith("openai/") ? "gpt-image-or" : "nano-banana", { refs: true, vision: true }, mtok(usd, out), OR, { source: "openrouter" }, { note });

/** OpenRouter video models: durations, resolutions and per-second prices come from `/api/v1/videos/models` at call time. */
const orVideo = (id: string, label: string, family: Family, perSec: number, c: { max: number; min?: number; res: string; audio?: boolean; open?: boolean }) =>
  E(id, label, "openrouter", ["video"], family, { i2v: true, t2v: true, firstLast: true, minSeconds: c.min, maxSeconds: c.max, resolution: c.res, audioOut: c.audio, openSource: c.open }, per(perSec, "per_sec", "live"), OR, { source: "openrouter-video" });

/** fal video: `id` is the image-to-video endpoint, `t2v` its text-to-video sibling. */
const falVideo = (id: string, label: string, family: Family, perSec: number, c: { max: number; min?: number; res: string; audio?: boolean; open?: boolean; license?: string; hfRepo?: string; firstLast?: boolean }, t2v?: string, note?: string) =>
  E(id, label, "fal", ["video"], family, { i2v: true, t2v: !!t2v, firstLast: c.firstLast ?? true, minSeconds: c.min, maxSeconds: c.max, resolution: c.res, audioOut: c.audio, openSource: c.open, license: c.license, hfRepo: c.hfRepo }, per(perSec), FAL, { source: "fal" }, { fal: t2v ? { t2v } : undefined, note });

const hfmcpVideo = (name: string, label: string, c: { max?: number; res?: string; audio?: boolean } = {}) =>
  E(`hfmcp:${name}`, `${label} (Higgsfield credits)`, "hfmcp", ["video"], "higgsfield-video", { i2v: true, t2v: true, maxSeconds: c.max, resolution: c.res, audioOut: c.audio }, credits, null, { source: "higgsfield-mcp", lookup: name });

const falImage = (id: string, label: string, family: Family, usd: number, c: { open?: boolean; license?: string; hfRepo?: string; edit?: string } = {}) =>
  E(id, label, "fal", ["image"], family, { refs: !!c.edit, openSource: c.open, license: c.license, hfRepo: c.hfRepo }, per(usd, "per_image"), FAL, { source: "fal" }, { fal: c.edit ? { edit: c.edit } : undefined });

const falVoice = (id: string, label: string, family: Family, usdPer1k: number, c: { open?: boolean; hfRepo?: string; license?: string } = {}, note?: string) =>
  E(id, label, "fal", ["voice"], family, { openSource: c.open, hfRepo: c.hfRepo, license: c.license }, per(usdPer1k, "per_1k_chars"), FAL, { source: "fal" }, { note });

const falAudio = (id: string, label: string, stage: "music" | "sfx", family: Family, usd: number, unit: Cost["unit"], c: { max?: number; open?: boolean; hfRepo?: string } = {}) =>
  E(id, label, "fal", [stage], family, { maxSeconds: c.max, openSource: c.open, hfRepo: c.hfRepo }, per(usd, unit), FAL, { source: "fal" });

const fal3d = (id: string, label: string, usd: number, c: { open?: boolean; hfRepo?: string; t2?: boolean } = {}) =>
  E(id, label, "fal", ["asset3d"], "mesh3d", { threeD: true, openSource: c.open, hfRepo: c.hfRepo, i2v: false }, per(usd, "per_asset"), FAL, { source: "fal" });

export const CATALOG: ModelEntry[] = [
  // ---------- Text: research & brief, script, shot-sheet enhancer (OpenRouter) ----------
  llm("anthropic/claude-sonnet-5.5", "Claude Sonnet 5.5", "claude", 2, 10, { vision: true }),
  llm("anthropic/claude-opus-5.5", "Claude Opus 5.5", "claude", 4, 20, { vision: true }),
  llm("anthropic/claude-fable-5.2", "Claude Fable 5.2", "claude", 8, 40, { vision: true }),
  llm("anthropic/claude-haiku-5.5", "Claude Haiku 5.5", "claude", 0.1, 0.5, { vision: true }),
  llm("google/gemini-4-neon", "Gemini 4 Neon", "gemini", 3, 15, { vision: true }),
  llm("google/gemini-4-carbon", "Gemini 4 Carbon", "gemini", 2, 10, { vision: true }),
  llm("google/gemini-4-hydrogen", "Gemini 4 Hydrogen", "gemini", 1.5, 7.5, { vision: true }),
  llm("google/gemini-3.8-flash", "Gemini 3.8 Flash", "gemini", 0.825, 4.125, { vision: true }),
  llm("openai/gpt-6.2-sol", "GPT-6.2 Sol", "gpt", 2, 10, { vision: true }),
  llm("openai/gpt-6.2-astra", "GPT-6.2 Astra", "gpt", 8, 40, { vision: true }),
  llm("openai/gpt-6.1-sol", "GPT-6.1 Sol", "gpt", 2, 10, { vision: true }),
  llm("x-ai/grok-4.7", "Grok 4.7", "gpt", 2, 6, { vision: true }),
  llm("qwen/qwen4-max", "Qwen 4 Max", "open-llm", 1.425, 4.275, { vision: true }),
  llm("qwen/qwen3.8-27b", "Qwen 3.8 27B (open)", "open-llm", 0.06, 2.2, { vision: true, open: true }),
  llm("deepseek/deepseek-v4-pro", "DeepSeek V4 Pro (open)", "open-llm", 0.9, 1.5, { open: true }),
  llm("z-ai/glm-5.3", "GLM 5.3 (open)", "open-llm", 0.07, 1.4, { open: true }),
  llm("moonshotai/kimi-k3.1-pro", "Kimi K3.1 Pro (open)", "open-llm", 0.253, 8.8, { vision: true, open: true }),
  llm("openai/gpt-oss-120b", "gpt-oss 120B (open)", "open-llm", 0.15, 0.6, { open: true }),
  llm("meta-llama/llama-4-maverick", "Llama 4 Maverick (open)", "open-llm", 0.35, 1, { vision: true, open: true }),
  // Hugging Face Inference Providers (HF_TOKEN): same open weights, a second route that does not need OpenRouter.
  hf("Qwen/Qwen3.8-27B", "Qwen 3.8 27B (HF router)", 0.06, 2.2, true),
  hf("openai/gpt-oss-120b", "gpt-oss 120B (HF router)", 0.15, 0.6),
  hf("deepseek-ai/DeepSeek-V4-Pro", "DeepSeek V4 Pro (HF router)", 0.9, 1.5),
  hf("moonshotai/Kimi-K3.1-Pro", "Kimi K3.1 Pro (HF router)", 0.25, 8.8, true),
  hf("meta-llama/Llama-3.3-70B-Instruct", "Llama 3.3 70B (HF router)", 0.4, 0.4),

  // ---------- Image & keyframes ----------
  orImage("google/gemini-nano-banana-2.1", "Nano Banana 2.1", 1.5, 7.5),
  orImage("google/gemini-3-pro-image", "Gemini 3 Pro Image", 2, 12),
  orImage("google/gemini-3.1-flash-image", "Gemini 3.1 Flash Image", 0.5, 3),
  orImage("openai/gpt-5.4-image-2", "GPT-5.4 Image 2", 8, 15),
  falImage("fal-ai/nano-banana-pro", "Nano Banana Pro (fal)", "nano-banana", 0.15, { edit: "fal-ai/nano-banana-pro/edit" }),
  falImage("google/nano-banana-2.1", "Nano Banana 2.1 (fal)", "nano-banana", 0.08),
  falImage("fal-ai/flux-2-pro", "FLUX.2 Pro (fal)", "flux", 0.03, { edit: "fal-ai/flux-2-pro/edit" }),
  falImage("blackforestlabs/flux-3/text-to-image", "FLUX.3 (fal)", "flux", 0.06),
  falImage("bytedance/seedream/v5/pro/text-to-image", "Seedream 5 Pro (fal)", "seedream", 0.04),
  falImage("openai/gpt-image-2", "GPT Image 2 (fal)", "gpt-image", 0.1),
  falImage("ideogram/v4.5", "Ideogram 4.5 (fal)", "ideogram", 0.06),
  falImage("fal-ai/flux/schnell", "FLUX.1 schnell (fal, open)", "flux", 0.003, { open: true, license: "apache-2.0", hfRepo: "black-forest-labs/FLUX.1-schnell" }),
  falImage("fal-ai/z-image/turbo", "Z-Image Turbo (fal, open)", "z-image", 0.005, { open: true, license: "apache-2.0", hfRepo: "Tongyi-MAI/Z-Image-Turbo" }),
  falImage("fal-ai/qwen-image", "Qwen-Image (fal, open)", "qwen-image", 0.02, { open: true, license: "apache-2.0", hfRepo: "Qwen/Qwen-Image" }),
  falImage("fal-ai/hunyuan-image/v3/text-to-image", "HunyuanImage 3 (fal, open weights)", "hunyuan-image", 0.1, { open: true, hfRepo: "tencent/HunyuanImage-3.0" }),
  falImage("fal-ai/flux/dev", "FLUX.1 dev (fal, open weights)", "flux", 0.025, { open: true, license: "flux-1-dev-non-commercial", hfRepo: "black-forest-labs/FLUX.1-dev" }),
  E("higgsfield-img:nano_banana_2_1", "Nano Banana 2.1 (Higgsfield credits)", "hfmcp", ["image"], "nano-banana", { refs: true }, credits, null, { source: "higgsfield-mcp", lookup: "nano_banana_2_1" }, { runnable: false, note: "Catalogued from the Higgsfield MCP list; no image adapter yet." }),
  E("higgsfield-img:gpt_image_2_6", "GPT Image 2.6 (Higgsfield credits)", "hfmcp", ["image"], "gpt-image", { refs: true }, credits, null, { source: "higgsfield-mcp", lookup: "gpt_image_2_6" }, { runnable: false, note: "Catalogued from the Higgsfield MCP list; no image adapter yet." }),
  E("higgsfield-img:flux_3_image", "FLUX.3 (Higgsfield credits)", "hfmcp", ["image"], "flux", {}, credits, null, { source: "higgsfield-mcp", lookup: "flux_3_image" }, { runnable: false, note: "Catalogued from the Higgsfield MCP list; no image adapter yet." }),
  E("higgsfield-img:soul_2", "Soul 2 (Higgsfield credits)", "hfmcp", ["image"], "generic-image", {}, credits, null, { source: "higgsfield-mcp", lookup: "soul_2" }, { runnable: false, note: "Higgsfield's own people/portrait model; no image adapter yet." }),

  // ---------- Video, per shot: OpenRouter ----------
  orVideo("bytedance/seedance-2.0-fast", "Seedance 2.0 Fast (OpenRouter)", "seedance", 0.121, { max: 15, min: 4, res: "720p", audio: true }),
  orVideo("bytedance/seedance-2.0", "Seedance 2.0 (OpenRouter)", "seedance", 0.151, { max: 15, min: 4, res: "4k", audio: true }),
  orVideo("bytedance/seedance-2.0-mini", "Seedance 2.0 Mini (OpenRouter)", "seedance", 0.076, { max: 15, min: 4, res: "720p", audio: true }),
  orVideo("bytedance/seedance-2.5", "Seedance 2.5 (OpenRouter)", "seedance", 0.231, { max: 30, min: 4, res: "1080p", audio: true }),
  orVideo("bytedance/seedance-2.5-flash", "Seedance 2.5 Flash (OpenRouter)", "seedance", 0.151, { max: 30, min: 4, res: "720p", audio: true }),
  orVideo("kwaivgi/kling-v3.0-std", "Kling 3.0 Std (OpenRouter)", "kling", 0.084, { max: 15, min: 3, res: "720p", audio: true }),
  orVideo("kwaivgi/kling-v3.0-pro", "Kling 3.0 Pro (OpenRouter)", "kling", 0.112, { max: 15, min: 3, res: "720p", audio: true }),
  orVideo("kwaivgi/kling-video-o1", "Kling O1 (OpenRouter)", "kling", 0.112, { max: 10, min: 5, res: "720p", audio: true }),
  orVideo("google/veo-3.1-lite", "Veo 3.1 Lite (OpenRouter)", "veo", 0.05, { max: 8, min: 4, res: "1080p", audio: true }),
  orVideo("google/veo-3.1-fast", "Veo 3.1 Fast (OpenRouter)", "veo", 0.1, { max: 8, min: 4, res: "4k", audio: true }),
  orVideo("google/veo-3.1", "Veo 3.1 (OpenRouter)", "veo", 0.4, { max: 8, min: 4, res: "4k", audio: true }),
  orVideo("google/gemini-omni-1.2-flash", "Gemini Omni 1.2 (OpenRouter)", "omni", 0.0695, { max: 15, min: 3, res: "4k", audio: true }),
  orVideo("alibaba/wan-3.0", "Wan 3.0 (OpenRouter)", "wan", 0.1, { max: 30, min: 2, res: "1080p", audio: true }),
  orVideo("alibaba/wan-3.0-prime", "Wan 3.0 Prime (OpenRouter)", "wan", 0.14, { max: 30, min: 2, res: "1080p", audio: true }),
  orVideo("alibaba/wan-2.7", "Wan 2.7 (OpenRouter)", "wan", 0.1, { max: 10, min: 2, res: "1080p", audio: true }),
  orVideo("x-ai/grok-imagine-video-1.5", "Grok Imagine Video 1.5 (OpenRouter)", "grok", 0.07, { max: 15, min: 1, res: "1080p", audio: true }),
  orVideo("minimax/hailuo-3-max", "Hailuo 3 Max (OpenRouter)", "minimax", 0.08, { max: 15, min: 5, res: "768p" }),
  orVideo("black-forest-labs/flux-3-video", "FLUX.3 Video (OpenRouter)", "flux-video", 0.1, { max: 20, min: 5, res: "4k", audio: true }),
  orVideo("runway/gen-4.5", "Runway Gen-4.5 (OpenRouter)", "runway", 0.12, { max: 10, min: 2, res: "720p" }),

  // ---------- Video, per shot: fal ----------
  falVideo("fal-ai/veo3.1/image-to-video", "Veo 3.1 (fal)", "veo", 0.4, { max: 8, min: 4, res: "4k", audio: true }, "fal-ai/veo3.1"),
  falVideo("fal-ai/veo3.1/fast/image-to-video", "Veo 3.1 Fast (fal)", "veo", 0.15, { max: 8, min: 4, res: "4k", audio: true }, "fal-ai/veo3.1/fast"),
  falVideo("fal-ai/veo3.1/lite/image-to-video", "Veo 3.1 Lite (fal)", "veo", 0.08, { max: 8, min: 4, res: "1080p", audio: true }, "fal-ai/veo3.1/lite"),
  falVideo("kling/v4/image-to-video", "Kling 4.0 (fal)", "kling", 0.22, { max: 30, min: 3, res: "4k" }, "kling/v4/text-to-video"),
  falVideo("kling/v4/flash/image-to-video", "Kling 4.0 Flash (fal)", "kling", 0.1, { max: 20, min: 3, res: "720p" }, "kling/v4/flash/text-to-video"),
  falVideo("fal-ai/kling-video/v3/pro/image-to-video", "Kling 3.0 Pro (fal)", "kling", 0.17, { max: 15, min: 3, res: "1080p", audio: true }, "fal-ai/kling-video/v3/pro/text-to-video"),
  falVideo("fal-ai/kling-video/v2.5-turbo/pro/image-to-video", "Kling 2.5 Turbo Pro (fal)", "kling", 0.07, { max: 10, min: 5, res: "1080p" }),
  falVideo("bytedance/seedance-2.5/flash/image-to-video", "Seedance 2.5 Flash (fal)", "seedance", 0.15, { max: 30, min: 4, res: "720p", audio: true }, "bytedance/seedance-2.5/flash/text-to-video"),
  falVideo("bytedance/seedance-2.0/fast/image-to-video", "Seedance 2.0 Fast (fal)", "seedance", 0.12, { max: 15, min: 4, res: "720p", audio: true }, "bytedance/seedance-2.0/fast/text-to-video"),
  falVideo("fal-ai/bytedance/seedance/v1/pro/fast/image-to-video", "Seedance 1 Pro Fast (fal)", "seedance", 0.05, { max: 12, min: 2, res: "1080p" }),
  { ...falVideo("fal-ai/bytedance/seedance/v1/lite/image-to-video", "Seedance 1 Lite (fal, deprecated)", "seedance", 0.04, { max: 12, min: 2, res: "1080p" }), runnable: false, verify: { source: "unverified", note: "fal lists this endpoint as deprecated (checked 2026-11-19); use Seedance 1 Pro Fast." }, note: "Deprecated on fal; kept so saved plans still resolve." },
  falVideo("alibaba/wan-3.0/image-to-video", "Wan 3.0 (fal)", "wan", 0.1, { max: 30, min: 2, res: "1080p", audio: true }, "alibaba/wan-3.0/text-to-video"),
  falVideo("fal-ai/wan/v2.7/image-to-video", "Wan 2.7 (fal)", "wan", 0.1, { max: 15, min: 2, res: "1080p" }, "fal-ai/wan/v2.7/text-to-video"),
  falVideo("fal-ai/wan/v2.2-a14b/image-to-video", "Wan 2.2 A14B (fal, open)", "wan", 0.08, { max: 10, min: 1, res: "720p", open: true, license: "apache-2.0", hfRepo: "Wan-AI/Wan2.2-I2V-A14B" }, "fal-ai/wan/v2.2-a14b/text-to-video"),
  falVideo("fal-ai/wan/v2.2-5b/image-to-video", "Wan 2.2 5B (fal, open)", "wan", 0.04, { max: 10, min: 1, res: "720p", open: true, license: "apache-2.0", hfRepo: "Wan-AI/Wan2.2-TI2V-5B" }, "fal-ai/wan/v2.2-5b/text-to-video"),
  falVideo("fal-ai/ltx-2.3-22b/image-to-video", "LTX 2.3 22B (fal, open weights)", "ltx", 0.06, { max: 20, min: 1, res: "1080p", audio: true, open: true, license: "ltx-open-weights", hfRepo: "Lightricks/LTX-2" }, "fal-ai/ltx-2.3-22b/text-to-video"),
  falVideo("fal-ai/ltx-2.3-22b/distilled/image-to-video", "LTX 2.3 22B Distilled (fal, open weights)", "ltx", 0.04, { max: 20, min: 1, res: "1080p", audio: true, open: true, license: "ltx-open-weights", hfRepo: "Lightricks/LTX-2" }, "fal-ai/ltx-2.3-22b/distilled/text-to-video"),
  falVideo("lightricks/ltx-2.5/image-to-video/pro", "LTX 2.5 Pro (fal)", "ltx", 0.1, { max: 10, min: 6, res: "1080p", audio: true }, "lightricks/ltx-2.5/text-to-video/pro"),
  falVideo("fal-ai/longcat-video/image-to-video/720p", "LongCat Video 720p (fal, open)", "longcat", 0.04, { max: 32, min: 1, res: "720p", open: true, license: "mit", hfRepo: "meituan-longcat/LongCat-Video", firstLast: false }, "fal-ai/longcat-video/text-to-video/720p"),
  falVideo("minimax/h3-max/image-to-video", "MiniMax H3 Max (fal)", "minimax", 0.12, { max: 15, min: 1, res: "1080p" }, "minimax/h3-max/text-to-video"),
  falVideo("fal-ai/minimax/hailuo-2.3/standard/image-to-video", "Hailuo 2.3 Standard (fal)", "minimax", 0.05, { max: 10, min: 6, res: "768p", firstLast: false }, "fal-ai/minimax/hailuo-2.3/standard/text-to-video"),
  falVideo("xai/grok-imagine-video/v1.5/image-to-video", "Grok Imagine Video 1.5 (fal)", "grok", 0.07, { max: 15, min: 1, res: "1080p", audio: true, firstLast: false }, "xai/grok-imagine-video/v1.5/text-to-video"),
  falVideo("google/gemini-omni-flash/v1.2/image-to-video", "Gemini Omni Flash 1.2 (fal)", "omni", 0.07, { max: 15, min: 3, res: "4k", audio: true }, "google/gemini-omni-flash/v1.2/text-to-video"),
  falVideo("fal-ai/pixverse/v6/image-to-video", "PixVerse V6 (fal)", "pixverse", 0.08, { max: 15, min: 1, res: "1080p", firstLast: false }, "fal-ai/pixverse/v6/text-to-video"),
  falVideo("fal-ai/vidu/q3/image-to-video", "Vidu Q3 (fal)", "vidu", 0.07, { max: 16, min: 1, res: "1080p", audio: true }, "fal-ai/vidu/q3/text-to-video"),
  falVideo("luma/agent/ray/v3.2/image-to-video", "Luma Ray 3.2 (fal)", "luma", 0.15, { max: 10, min: 5, res: "1080p" }, "luma/agent/ray/v3.2/text-to-video"),

  // ---------- Video, per shot: Higgsfield (API key, then subscription credits through the MCP) ----------
  E("higgsfield:bytedance/seedance-2.0/text-to-video", "Seedance 2.0 (Higgsfield)", "higgsfield", ["video"], "seedance", { i2v: true, t2v: true, maxSeconds: 12 }, per(0.1), "HF_API_KEY", { source: "unverified", note: "Higgsfield's API has no key-less model list; id kept from the first MVP." }),
  E("higgsfield:bytedance/seedance-2.5/text-to-video", "Seedance 2.5 (Higgsfield)", "higgsfield", ["video"], "seedance", { i2v: true, t2v: true, maxSeconds: 12 }, per(0.15), "HF_API_KEY", { source: "unverified", note: "Higgsfield's API has no key-less model list; id kept from the first MVP." }),
  E("higgsfield:kling-video/v3.0/std/text-to-video", "Kling 3.0 Std (Higgsfield)", "higgsfield", ["video"], "kling", { i2v: true, t2v: true, maxSeconds: 10 }, per(0.08), "HF_API_KEY", { source: "unverified", note: "Higgsfield's API has no key-less model list; id kept from the first MVP." }),
  E("higgsfield:kling-video/v3.0/pro/text-to-video", "Kling 3.0 Pro (Higgsfield)", "higgsfield", ["video"], "kling", { i2v: true, t2v: true, maxSeconds: 10 }, per(0.12), "HF_API_KEY", { source: "unverified", note: "Higgsfield's API has no key-less model list; id kept from the first MVP." }),
  hfmcpVideo("seedance_2_0", "Seedance 2.0", { audio: true }),
  hfmcpVideo("seedance_2_5", "Seedance 2.5", { audio: true }),
  hfmcpVideo("kling3_0", "Kling 3.0", { max: 10 }),
  hfmcpVideo("kling4_0", "Kling 4.0"),
  hfmcpVideo("wan3_0", "Wan 3.0"),
  hfmcpVideo("veo3_1", "Veo 3.1", { max: 8, audio: true }),
  E("hfmcp:seedance1_5", "Seedance 1.5 Pro (Higgsfield credits)", "hfmcp", ["video"], "seedance", { i2v: true, t2v: true, maxSeconds: 12 }, credits, null, { source: "unverified", note: "Not in the Higgsfield MCP model list on 2026-11-19; kept because saved plans may still reference it." }),

  // ---------- Video: open weights without a hosted API, world models, local renderers ----------
  E("hf-weights:tencent/HunyuanVideo-1.5", "HunyuanVideo 1.5 (open weights)", "huggingface", ["video"], "hunyuan", { t2v: true, i2v: false, openSource: true, hfRepo: "tencent/HunyuanVideo-1.5", license: "tencent-hunyuan" }, FREE, null, { source: "local", note: "Weights verified on Hugging Face; no hosted endpoint serves it (fal and OpenRouter list none)." }, { runnable: false, note: "Open weights only: no hosted endpoint serves it today (fal and OpenRouter list none). Run it on a rented GPU." }),
  E("higgsfield-gpu:wan-2-2-t2v-a14b", "Wan 2.2 T2V A14B (Higgsfield GPU rental)", "hfmcp", ["video"], "wan", { t2v: true, openSource: true, hfRepo: "Wan-AI/Wan2.2-T2V-A14B", license: "apache-2.0" }, credits, null, { source: "higgsfield-mcp", note: "Served via `gpu_list_models` (rented GPU, hourly price)." }, { runnable: false, note: "Open model on a rented GPU; billed by the hour, so no one-click adapter." }),
  E("higgsfield-gpu:ltx-video", "LTX Video (Higgsfield GPU rental)", "hfmcp", ["video"], "ltx", { t2v: true, i2v: true, openSource: true, hfRepo: "Lightricks/LTX-Video" }, credits, null, { source: "higgsfield-mcp", note: "Served via `gpu_list_models` (rented GPU, hourly price)." }, { runnable: false, note: "Open model on a rented GPU; billed by the hour, so no one-click adapter." }),
  E("alibaba/abot-world-0", "Abot World 0 (fal, real-time world model)", "fal", ["video"], "world", { worldModel: true, t2v: false, i2v: false }, per(0), FAL, { source: "fal" }, { runnable: false, note: "Interactive WebRTC session (SDP offer), not a batch clip API." }),
  E("vast/eden-live-14b-game", "Eden Live 14B Game (fal, real-time world model)", "fal", ["video"], "world", { worldModel: true, t2v: false, i2v: false }, per(0), FAL, { source: "fal" }, { runnable: false, note: "Interactive WebRTC session (SDP offer), not a batch clip API." }),
  E("robbyant/lingbot-world-2", "LingBot World 2 (fal, research license)", "fal", ["video"], "world", { worldModel: true, openSource: true, license: "research" }, per(0), FAL, { source: "fal" }, { runnable: false, note: "Interactive WebRTC session; research-only license." }),
  E("blender:shot", "Blender 3D shot (local, free)", "local-blender", ["video"], "blender", { t2v: false, i2v: false, maxSeconds: 20, resolution: "1080p", openSource: true, threeD: true }, FREE, null, { source: "local" }, { note: "Renders on this Mac with EEVEE; keeps the real product label. Needs Blender (BLENDER_BIN)." }),
  E("remotion:card", "Remotion motion graphics (local, free)", "local-remotion", ["video"], "remotion", { t2v: false, i2v: false, maxSeconds: 20, resolution: "1080p", openSource: true }, FREE, null, { source: "local" }, { note: "Text, end cards and kinetic type; exact copy, no AI spelling." }),

  // ---------- Voice ----------
  falVoice("fal-ai/elevenlabs/tts/eleven-v3", "ElevenLabs v3 (fal)", "eleven", 0.1, {}, "Default: won the 13.29 A/B."),
  falVoice("elevenlabs/tts/eleven-v4", "ElevenLabs v4 (fal)", "eleven", 0.1),
  falVoice("elevenlabs/tts/eleven-v4-turbo", "ElevenLabs v4 Turbo (fal)", "eleven", 0.05),
  falVoice("fal-ai/elevenlabs/tts/turbo-v2.5", "ElevenLabs Turbo v2.5 (fal)", "eleven", 0.05),
  falVoice("fal-ai/gemini-3.1-flash-tts", "Gemini 3.1 Flash TTS (fal)", "gemini-tts", 0.03),
  falVoice("fal-ai/minimax/speech-2.8-hd", "MiniMax Speech 2.8 HD (fal)", "minimax-speech", 0.1),
  falVoice("fal-ai/chatterbox/text-to-speech", "Chatterbox (fal, open MIT)", "chatterbox", 0.025, { open: true, hfRepo: "ResembleAI/chatterbox", license: "mit" }),
  falVoice("fal-ai/qwen-3-tts/text-to-speech/1.7b", "Qwen3 TTS 1.7B (fal, open)", "qwen-tts", 0.02, { open: true }),
  E("fal-ai/inworld-tts", "Inworld TTS (fal)", "fal", ["voice"], "inworld", {}, per(0.03, "per_1k_chars"), FAL, { source: "fal" }),
  E("higgsfield-voice:seed_audio", "Seed Audio 1.0 (Higgsfield credits)", "hfmcp", ["voice"], "seed-audio", {}, credits, null, { source: "higgsfield-mcp", lookup: "seed_audio" }, { runnable: false, note: "Higgsfield's default speech model; needs the account connected, no adapter yet." }),
  E("higgsfield-voice:text2speech_v2", "Text to Speech V2 (Higgsfield credits)", "hfmcp", ["voice"], "text2speech", {}, credits, null, { source: "higgsfield-mcp", lookup: "text2speech_v2" }, { runnable: false, note: "Needs the Higgsfield account connected; no adapter yet." }),

  // ---------- Music ----------
  falAudio("fal-ai/stable-audio-25/text-to-audio", "Stable Audio 2.5 (fal)", "music", "stable-audio", 0.2, "per_clip", { max: 190 }),
  falAudio("fal-ai/stable-audio-3/medium/text-to-audio", "Stable Audio 3 Medium (fal)", "music", "stable-audio", 0.2, "per_clip", { max: 190, open: true, hfRepo: "stabilityai/stable-audio-3-medium" }),
  falAudio("elevenlabs/music/v2.5", "ElevenLabs Music v2.5 (fal)", "music", "eleven-music", 0.6, "per_clip", { max: 300 }),
  falAudio("fal-ai/lyria3", "Lyria 3 (fal)", "music", "lyria", 0.08, "per_clip", { max: 60 }),
  falAudio("fal-ai/minimax-music/v2.6", "MiniMax Music 2.6 (fal)", "music", "minimax-music", 0.15, "per_clip"),
  falAudio("fal-ai/ace-step", "ACE-Step (fal, open)", "music", "ace-step", 0.05, "per_clip", { max: 240, open: true }),
  E("local-synth:bed", "Local synth drone bed (free)", "local-synth", ["music"], "synth", { openSource: true }, FREE, null, { source: "local" }, { runnable: false, note: "The foley-first bed (builder C) is synthesised with FFmpeg; not called through the registry yet." }),

  // ---------- Sound effects ----------
  E("local-synth:foley", "Local synthesised foley (free)", "local-synth", ["sfx"], "synth", { openSource: true }, FREE, null, { source: "local" }, { note: "FFmpeg-synthesised whoosh, pop, fizz, pour and clink from src/lib/sfx.ts; the default SFX source, no API." }),
  falAudio("fal-ai/mmaudio-v2", "MMAudio V2 (fal, video-to-audio)", "sfx", "generic-audio", 0.001, "per_sec", { max: 10 }),
  falAudio("sonilo/v1.1/text-to-sound-effects", "Sonilo v1.1 SFX (fal, text-to-audio)", "sfx", "generic-audio", 0.0018, "per_sec", { max: 30 }),
  falAudio("elevenlabs/sound-effects/v3", "ElevenLabs Sound Effects v3 (fal)", "sfx", "eleven-sfx", 0.002, "per_sec", { max: 30 }),
  falAudio("fal-ai/stable-audio-3/small/sfx/text-to-audio", "Stable Audio 3 Small SFX (fal, open)", "sfx", "stable-audio", 0.02, "per_clip", { max: 30, open: true, hfRepo: "stabilityai/stable-audio-3-medium" }),
  falAudio("cassetteai/sound-effects-generator", "CassetteAI SFX (fal)", "sfx", "generic-audio", 0.02, "per_clip", { max: 30 }),
  falAudio("mirelo-ai/sfx2.0/text-to-audio", "Mirelo SFX 2.0 (fal)", "sfx", "generic-audio", 0.02, "per_clip", { max: 30 }),

  // ---------- QA judge: every vision-capable chat model above lists the `qa` stage (Gemini reads video too) ----------

  // ---------- 3D assets (feed Blender) ----------
  // Product 3D asset: one product photo in, a textured game-ready GLB out (src/lib/registry/product-3d.ts caches it by input
  // hash and Blender imports it for product and hero shots). Schema read from fal's OpenAPI on 2026-11-19: input `image_url`,
  // `image_type`, `enable_pbr`, `mesh_resolution`, `rig`; output `game_glb` (30k triangles, UVs, 2048px base color + normal map).
  { ...fal3d("speridlabs/idol/max/turbo", "Idol Max Turbo (fal): product photo to GLB, fast", 0.1), note: "Projects the texture from the splat; about 20 s. Auto uses it for previews. A real can test (2026-11-19) was not hero quality: for cans, bottles and boxes use the Blender primitive." },
  { ...fal3d("speridlabs/idol/max", "Idol Max (fal): product photo to GLB, repainted texture", 0.2), note: "Repaints the base color from the photo: slower, sharper label texture. The stage default and what Auto uses for finals, for irregular products only (shoes, toys, gadgets, characters)." },
  fal3d("tripo3d/h3.1/image-to-3d", "Tripo H3.1 image to 3D (fal)", 0.3),
  fal3d("fal-ai/hunyuan-3d/v3.1/pro/image-to-3d", "Hunyuan 3D 3.1 Pro (fal)", 0.4),
  fal3d("fal-ai/trellis-2", "TRELLIS.2 (fal, open)", 0.1, { open: true, hfRepo: "microsoft/TRELLIS.2-4B" }),
  fal3d("meshy/v7.1/image-to-3d", "Meshy 7.1 image to 3D (fal)", 0.3),
  fal3d("fal-ai/hyper3d/rodin/v2.5", "Hyper3D Rodin 2.5 (fal)", 0.4),
  fal3d("fal-ai/hunyuan3d/v2", "Hunyuan3D 2 (fal, open weights)", 0.16, { open: true, hfRepo: "tencent/Hunyuan3D-2" }),
  E("higgsfield-3d:tripo_h3_1_image_to_3d", "Tripo H3.1 (Higgsfield credits)", "hfmcp", ["asset3d"], "mesh3d", { threeD: true }, credits, null, { source: "higgsfield-mcp", lookup: "tripo_h3_1_image_to_3d" }, { runnable: false, note: "Higgsfield MCP generate_3d; no adapter yet." }),
];
