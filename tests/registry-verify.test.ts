import { describe, expect, it } from "vitest";
import { CATALOG } from "@/lib/registry/catalog";
import { checkCatalog, checkEntry, type ProviderLists } from "@/lib/registry/verify";
import type { ModelEntry } from "@/lib/registry/types";

const e = (id: string): ModelEntry => CATALOG.find((x) => x.id === id)!;

function lists(over: Partial<ProviderLists> = {}): ProviderLists {
  return {
    openrouter: new Map([["anthropic/claude-sonnet-5.5", { out: ["text"], inUsdPerM: 2, outUsdPerM: 10 }], ["google/gemini-nano-banana-2.1", { out: ["image", "text"], inUsdPerM: 1.5, outUsdPerM: 7.5 }]]),
    orVideo: new Map([["bytedance/seedance-2.0-fast", { maxSeconds: 15, minSeconds: 4 }]]),
    fal: new Map([["fal-ai/veo3.1/image-to-video", "active"], ["fal-ai/veo3.1", "active"]]),
    hfRouter: new Set(["openai/gpt-oss-120b"]),
    higgsfield: new Set(["kling3_0"]),
    hfRepos: new Set(["Wan-AI/Wan2.2-I2V-A14B"]),
    ...over,
  };
}

describe("verify-models logic", () => {
  it("passes models that are on their provider's list", () => {
    expect(checkEntry(e("anthropic/claude-sonnet-5.5"), lists()).status).toBe("verified");
    expect(checkEntry(e("bytedance/seedance-2.0-fast"), lists()).status).toBe("verified");
    expect(checkEntry(e("fal-ai/veo3.1/image-to-video"), lists()).status).toBe("verified");
    expect(checkEntry(e("hf:openai/gpt-oss-120b"), lists()).status).toBe("verified");
    expect(checkEntry(e("hfmcp:kling3_0"), lists()).status).toBe("verified");
  });
  it("fails a model that left the list", () => {
    const r = checkEntry(e("anthropic/claude-opus-5.5"), lists());
    expect(r.status).toBe("missing");
    expect(r.errors[0]).toMatch(/not in OpenRouter/);
    expect(checkEntry(e("hfmcp:wan3_0"), lists()).status).toBe("missing");
  });
  it("fails when a fal text-to-video sibling is gone or deprecated", () => {
    expect(checkEntry(e("fal-ai/veo3.1/image-to-video"), lists({ fal: new Map([["fal-ai/veo3.1/image-to-video", "active"]]) })).errors[0]).toMatch(/fal-ai\/veo3.1 is not a fal endpoint/);
    expect(checkEntry(e("fal-ai/veo3.1/image-to-video"), lists({ fal: new Map([["fal-ai/veo3.1/image-to-video", "deprecated"], ["fal-ai/veo3.1", "active"]]) })).errors[0]).toMatch(/deprecated/);
  });
  it("warns about price drift instead of failing", () => {
    const r = checkEntry(e("anthropic/claude-sonnet-5.5"), lists({ openrouter: new Map([["anthropic/claude-sonnet-5.5", { out: ["text"], inUsdPerM: 4, outUsdPerM: 20 }]]) }));
    expect(r.status).toBe("verified");
    expect(r.warnings[0]).toMatch(/price drift/);
  });
  it("requires image output for image models on OpenRouter", () => {
    const r = checkEntry(e("google/gemini-nano-banana-2.1"), lists({ openrouter: new Map([["google/gemini-nano-banana-2.1", { out: ["text"], inUsdPerM: 1.5, outUsdPerM: 7.5 }]]) }));
    expect(r.status).toBe("missing");
  });
  it("reports unverified entries without failing the run, and checks open-weights repos", () => {
    const u = checkEntry(e("hfmcp:seedance1_5"), lists());
    expect(u.status).toBe("unverified");
    expect(u.warnings[0]).toMatch(/Not in the Higgsfield MCP/);
    expect(checkEntry(e("fal-ai/wan/v2.2-a14b/image-to-video"), lists(), { repoCheck: true }).errors.join()).toMatch(/not a fal endpoint/);
    const repo = checkEntry({ ...e("fal-ai/veo3.1/image-to-video"), caps: { hfRepo: "x/y" } }, lists(), { repoCheck: true });
    expect(repo.errors.join()).toMatch(/Hugging Face repo x\/y not found/);
  });
  it("flags duplicate ids and catalog-only entries without a note", () => {
    const a = e("anthropic/claude-sonnet-5.5");
    const out = checkCatalog([a, a, { ...e("alibaba/abot-world-0"), note: undefined }], lists());
    expect(out.ok).toBe(false);
    expect(out.results[1].errors).toContain("duplicate id");
    expect(out.results[2].errors).toContain("catalog-only entries need a note");
  });
});
