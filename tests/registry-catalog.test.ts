import { describe, expect, it } from "vitest";
import { CATALOG, STAGES, STAGE_DEFAULTS, defaultFor, getModel, modelsFor, resolvePick, sanitizePicks, estimateUsd, type Stage } from "@/lib/registry";
import { FAL_KNOBS } from "@/lib/registry/fal-snapshot";
import { readiness } from "@/lib/registry/ready";
import { DEFAULTS, MODELS, providerConfigured, providerOf } from "@/lib/models";

const ALL: Stage[] = ["research", "script", "enhancer", "image", "video", "voice", "music", "sfx", "qa", "asset3d"];

describe("registry catalog", () => {
  it("declares every model once, with the fields the pickers and adapters need", () => {
    expect(new Set(CATALOG.map((e) => e.id)).size).toBe(CATALOG.length);
    for (const e of CATALOG) {
      expect(e.stages.length, e.id).toBeGreaterThan(0);
      expect(e.label, e.id).toBeTruthy();
      expect(e.cost.unit, e.id).toBeTruthy();
      if (e.runnable) expect(["openrouter", "fal", "higgsfield", "hfmcp", "huggingface", "local-blender", "local-remotion", "local-synth"], e.id).toContain(e.provider);
      else expect(e.note, `${e.id} is catalog-only and must say why`).toBeTruthy();
    }
  });

  it("names the env var each provider needs", () => {
    const need = { openrouter: "OPENROUTER_API_KEY", fal: "FAL_KEY", huggingface: "HF_TOKEN", higgsfield: "HF_API_KEY" } as const;
    for (const e of CATALOG.filter((x) => x.provider in need)) {
      if (e.runnable || e.provider === "fal" || e.provider === "openrouter") expect(e.env, e.id).toBe(need[e.provider as keyof typeof need]);
    }
    expect(CATALOG.filter((e) => e.provider.startsWith("local-")).every((e) => e.env === null)).toBe(true);
  });

  it("serves every stage, with a default that exists, serves the stage and is callable", () => {
    for (const stage of ALL) {
      expect(STAGES.some((s) => s.id === stage)).toBe(true);
      const d = getModel(STAGE_DEFAULTS[stage]);
      expect(d, stage).toBeTruthy();
      expect(d!.stages, stage).toContain(stage);
      expect(d!.runnable, `${stage} default ${d!.id}`).toBe(true);
      expect(modelsFor(stage, { runnableOnly: true }).length, stage).toBeGreaterThan(1);
    }
  });

  it("covers the open-source families, world models and 3D generators the brief asked for", () => {
    const open = CATALOG.filter((e) => e.caps.openSource);
    for (const re of [/wan/i, /ltx/i, /hunyuan/i, /flux/i, /stable audio/i, /longcat/i, /qwen/i, /trellis/i]) expect(open.some((e) => re.test(e.label)), String(re)).toBe(true);
    expect(CATALOG.some((e) => e.caps.worldModel)).toBe(true);
    expect(CATALOG.some((e) => e.caps.threeD && e.provider === "fal")).toBe(true);
    expect(CATALOG.filter((e) => e.caps.worldModel).every((e) => !e.runnable)).toBe(true);
  });

  it("marks anything it could not verify, and says why", () => {
    const un = CATALOG.filter((e) => e.verify.source === "unverified");
    expect(un.map((e) => e.id)).toContain("hfmcp:seedance1_5");
    for (const e of un) expect(e.verify.note, e.id).toBeTruthy();
  });

  it("has a request schema snapshot for every runnable fal endpoint it can call", () => {
    for (const e of CATALOG.filter((x) => x.provider === "fal" && x.runnable)) {
      for (const ep of [e.id, e.fal?.t2v, e.fal?.edit].filter(Boolean) as string[]) expect(FAL_KNOBS[ep], ep).toBeTruthy();
    }
  });
});

describe("defaults and picks", () => {
  it("honours STAGE_MODEL_<STAGE> only for a model that serves the stage", () => {
    expect(defaultFor("voice", { STAGE_MODEL_VOICE: "elevenlabs/tts/eleven-v4" })).toBe("elevenlabs/tts/eleven-v4");
    expect(defaultFor("voice", { STAGE_MODEL_VOICE: "anthropic/claude-sonnet-5.5" })).toBe(STAGE_DEFAULTS.voice);
    expect(defaultFor("voice", { STAGE_MODEL_VOICE: "nope" })).toBe(STAGE_DEFAULTS.voice);
  });
  it("sanitises untrusted picks and only allows auto for video", () => {
    expect(sanitizePicks({ video: "auto", voice: "auto", image: "fal-ai/nano-banana-pro", music: "not-a-model", bogus: "x", research: 5 })).toEqual({ video: "auto", image: "fal-ai/nano-banana-pro" });
    expect(sanitizePicks("junk")).toEqual({});
    expect(resolvePick({ video: "nope" }, "video")).toBe(STAGE_DEFAULTS.video);
    expect(resolvePick({ video: "auto" }, "video")).toBe("auto");
  });
  it("estimates cost per unit", () => {
    expect(estimateUsd(getModel("fal-ai/veo3.1/fast/image-to-video")!, { seconds: 4 })).toBeCloseTo(0.6);
    expect(estimateUsd(getModel("fal-ai/elevenlabs/tts/eleven-v3")!, { chars: 1000 })).toBeCloseTo(0.1);
    expect(estimateUsd(getModel("blender:shot")!, { seconds: 10 })).toBe(0);
  });
});

describe("readiness", () => {
  it("disables models whose key is missing, and says which one", () => {
    expect(readiness(getModel("fal-ai/nano-banana-pro")!, {})).toEqual({ ready: false, reason: "Set FAL_KEY" });
    expect(readiness(getModel("fal-ai/nano-banana-pro")!, { FAL_KEY: "x" })).toEqual({ ready: true });
    expect(readiness(getModel("hf:openai/gpt-oss-120b")!, {}).reason).toBe("Set HF_TOKEN");
    expect(readiness(getModel("anthropic/claude-sonnet-5.5")!, {}).reason).toBe("Set OPENROUTER_API_KEY");
  });
  it("disables catalog-only models with their note", () => {
    const r = readiness(getModel("alibaba/abot-world-0")!, { FAL_KEY: "x" });
    expect(r.ready).toBe(false);
    expect(r.reason).toMatch(/WebRTC/);
  });
});

describe("legacy MODELS view", () => {
  const LEGACY_IDS = [
    "anthropic/claude-sonnet-5.5", "anthropic/claude-opus-5.5", "google/gemini-3.8-flash", "google/gemini-nano-banana-2.1", "google/gemini-3-pro-image", "openai/gpt-5.4-image-2",
    "bytedance/seedance-2.0-fast", "bytedance/seedance-2.0", "kwaivgi/kling-v3.0-std", "kwaivgi/kling-v3.0-pro", "google/veo-3.1-lite", "google/veo-3.1-fast", "google/veo-3.1", "google/gemini-omni-1.2-flash", "alibaba/wan-3.0",
    "higgsfield:bytedance/seedance-2.0/text-to-video", "higgsfield:bytedance/seedance-2.5/text-to-video", "higgsfield:kling-video/v3.0/std/text-to-video", "higgsfield:kling-video/v3.0/pro/text-to-video",
    "hfmcp:seedance1_5", "hfmcp:wan3_0", "hfmcp:kling3_0", "hfmcp:seedance_2_0",
    "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video", "fal-ai/kling-video/v2.5-turbo/pro/image-to-video", "fal-ai/veo3.1/fast/image-to-video",
  ];
  it("keeps Seedance 1 Lite catalogued but not selectable: fal lists it as deprecated (2026-11-19)", () => {
    const e = getModel("fal-ai/bytedance/seedance/v1/lite/image-to-video")!;
    expect(e.runnable).toBe(false);
    expect(e.note).toMatch(/Deprecated/);
    expect(MODELS.some((m) => m.id === e.id)).toBe(false);
  });
  it("still offers every model the first MVP offered, under the same modality", () => {
    for (const id of LEGACY_IDS) expect(MODELS.some((m) => m.id === id), id).toBe(true);
    expect(MODELS.filter((m) => m.modality === "vision").map((m) => m.id)).toContain("anthropic/claude-sonnet-5.5");
    expect(MODELS.filter((m) => m.modality === "image").map((m) => m.id)).toContain("google/gemini-nano-banana-2.1");
  });
  it("keeps the defaults and the provider lookup", () => {
    expect(DEFAULTS.text).toBe("anthropic/claude-sonnet-5.5");
    expect(DEFAULTS.video).toBe("bytedance/seedance-2.0-fast");
    expect(providerOf("kling/v4/image-to-video")).toBe("fal");
    expect(providerOf("fal-ai/anything-else")).toBe("fal");
    expect(providerOf("hf:Qwen/Qwen3.8-27B")).toBe("huggingface");
    expect(providerOf("hfmcp:kling3_0")).toBe("hfmcp");
    expect(providerOf("higgsfield:x")).toBe("higgsfield");
    expect(providerOf("some/unknown")).toBe("openrouter");
    expect(providerConfigured("hfmcp")).toBe(true);
  });
  it("leaves local renderers and catalog-only entries out of the generate lists", () => {
    expect(MODELS.some((m) => m.id === "blender:shot" || m.id === "alibaba/abot-world-0")).toBe(false);
  });
});
