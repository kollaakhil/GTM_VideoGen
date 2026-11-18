export type Modality = "text" | "vision" | "image" | "video";
export type Provider = "openrouter" | "fal" | "higgsfield" | "hfmcp";

export interface ModelOption {
  id: string;
  label: string;
  provider: Provider;
  modality: Modality;
}

export const MODELS: ModelOption[] = [
  { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5", provider: "openrouter", modality: "text" },
  { id: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5", provider: "openrouter", modality: "text" },
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", provider: "openrouter", modality: "text" },
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash (vision)", provider: "openrouter", modality: "vision" },
  { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5 (vision)", provider: "openrouter", modality: "vision" },
  { id: "google/gemini-nano-banana-2.1", label: "Nano Banana 2.1", provider: "openrouter", modality: "image" },
  { id: "google/gemini-3-pro-image", label: "Gemini 3 Pro Image", provider: "openrouter", modality: "image" },
  { id: "openai/gpt-5.4-image-2", label: "GPT-5.4 Image 2", provider: "openrouter", modality: "image" },
  { id: "bytedance/seedance-2.0-fast", label: "Seedance 2.0 Fast (OpenRouter)", provider: "openrouter", modality: "video" },
  { id: "bytedance/seedance-2.0", label: "Seedance 2.0 (OpenRouter)", provider: "openrouter", modality: "video" },
  { id: "kwaivgi/kling-v3.0-std", label: "Kling 3.0 Std (OpenRouter)", provider: "openrouter", modality: "video" },
  { id: "kwaivgi/kling-v3.0-pro", label: "Kling 3.0 Pro (OpenRouter)", provider: "openrouter", modality: "video" },
  { id: "google/veo-3.1-lite", label: "Veo 3.1 Lite (OpenRouter)", provider: "openrouter", modality: "video" },
  { id: "google/veo-3.1-fast", label: "Veo 3.1 Fast (OpenRouter)", provider: "openrouter", modality: "video" },
  { id: "google/veo-3.1", label: "Veo 3.1 (OpenRouter)", provider: "openrouter", modality: "video" },
  { id: "google/gemini-omni-1.2-flash", label: "Gemini Omni 1.2 (OpenRouter)", provider: "openrouter", modality: "video" },
  { id: "alibaba/wan-3.0", label: "Wan 3.0 (OpenRouter)", provider: "openrouter", modality: "video" },
  { id: "higgsfield:bytedance/seedance-2.0/text-to-video", label: "Seedance 2.0 (Higgsfield)", provider: "higgsfield", modality: "video" },
  { id: "higgsfield:bytedance/seedance-2.5/text-to-video", label: "Seedance 2.5 (Higgsfield)", provider: "higgsfield", modality: "video" },
  { id: "higgsfield:kling-video/v3.0/std/text-to-video", label: "Kling 3.0 Std (Higgsfield)", provider: "higgsfield", modality: "video" },
  { id: "higgsfield:kling-video/v3.0/pro/text-to-video", label: "Kling 3.0 Pro (Higgsfield)", provider: "higgsfield", modality: "video" },
  { id: "hfmcp:seedance1_5", label: "Seedance 1.5 Pro (Higgsfield credits)", provider: "hfmcp", modality: "video" },
  { id: "hfmcp:wan3_0", label: "Wan 3.0 (Higgsfield credits)", provider: "hfmcp", modality: "video" },
  { id: "hfmcp:kling3_0", label: "Kling 3.0 (Higgsfield credits)", provider: "hfmcp", modality: "video" },
  { id: "hfmcp:seedance_2_0", label: "Seedance 2.0 (Higgsfield credits)", provider: "hfmcp", modality: "video" },
  { id: "fal-ai/bytedance/seedance/v1/lite/image-to-video", label: "Seedance 1 Lite (fal)", provider: "fal", modality: "video" },
  { id: "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video", label: "Seedance 1 Pro Fast (fal)", provider: "fal", modality: "video" },
  { id: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video", label: "Kling 2.5 Turbo Pro (fal)", provider: "fal", modality: "video" },
  { id: "fal-ai/veo3.1/fast/image-to-video", label: "Veo 3.1 Fast (fal)", provider: "fal", modality: "video" },
];

export const DEFAULTS = {
  text: process.env.TEXT_MODEL || "anthropic/claude-sonnet-5.5",
  vision: process.env.VISION_MODEL || "google/gemini-3.8-flash",
  image: process.env.IMAGE_MODEL || "google/gemini-nano-banana-2.1",
  video: process.env.VIDEO_MODEL || "bytedance/seedance-2.0-fast",
};

export function providerOf(modelId: string): Provider {
  if (modelId.startsWith("higgsfield:")) return "higgsfield";
  if (modelId.startsWith("hfmcp:")) return "hfmcp";
  return MODELS.find((m) => m.id === modelId)?.provider ?? (modelId.startsWith("fal-ai/") ? "fal" : "openrouter");
}

export function providerConfigured(p: Provider): boolean {
  if (p === "openrouter") return !!process.env.OPENROUTER_API_KEY;
  if (p === "fal") return !!process.env.FAL_KEY;
  if (p === "hfmcp") return true;
  return !!((process.env.HF_API_KEY_ID && process.env.HF_API_KEY_SECRET) || process.env.HF_API_KEY);
}
