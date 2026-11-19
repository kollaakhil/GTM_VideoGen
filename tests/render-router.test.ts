import { describe, expect, it, vi } from "vitest";
import { renderRouted, routeShot, type RendererSet } from "@/lib/render/router";
import { RendererUnavailable, rowFromShot, type Renderer, type RenderContext, type ShotRow } from "@/lib/render/types";
import { aiVideoRenderer, blenderRenderer, remotionRenderer } from "@/lib/render/renderers";
import type { Shot } from "@/lib/types";

const row = (o: Partial<ShotRow> = {}): ShotRow => ({ id: "s1", beat: "hook", seconds: 4, action: "A woman laughs and pours soda", camera: "slow push-in", ...o });
const ctx = (o: Partial<RenderContext> = {}): RenderContext => ({ mode: "preview", width: 486, height: 864, refs: ["data:image/png;base64,AAAA"], firstFrame: "data:image/png;base64,BBBB", prompt: "p", ...o });
const fake = (id: Renderer["id"], over: Partial<Renderer> = {}): Renderer => ({ id, available: async () => true, estimateUsd: () => 0, render: vi.fn(async () => ({ url: `data:video/mp4;base64,${id}`, costUsd: id === "ai-video" ? 0.3 : 0 })), ...over });

describe("routeShot", () => {
  it("operator choice wins over everything", () => {
    expect(routeShot(row({ renderer: "remotion", source: "packshot" }), { hasProductRef: true }).renderer).toBe("remotion");
  });
  it("model prefixes and the legacy packshot go to their renderer", () => {
    expect(routeShot(row({ model: "blender:packshot" }), { hasProductRef: true }).renderer).toBe("blender");
    expect(routeShot(row({ model: "remotion:card" }), { hasProductRef: false }).renderer).toBe("remotion");
    expect(routeShot(row({ source: "packshot" }), { hasProductRef: true }).renderer).toBe("blender");
  });
  it("graphic cards go to Remotion", () => {
    expect(routeShot(row({ graphic: true }), { hasProductRef: true }).renderer).toBe("remotion");
  });
  it("camera-only product shots go to Blender when opted in and a photo exists; people never do", () => {
    const hero = row({ action: "Macro close-up of condensation on the can, label facing camera", camera: "locked-off macro" });
    expect(routeShot(hero, { hasProductRef: true, autoBlender: true }).renderer).toBe("blender");
    expect(routeShot(hero, { hasProductRef: false, autoBlender: true }).renderer).toBe("ai-video");
    expect(routeShot(hero, { hasProductRef: true }).renderer).toBe("ai-video");
    expect(routeShot(row({ action: "Close-up of a hand pouring the can", camera: "macro" }), { hasProductRef: true, autoBlender: true }).renderer).toBe("ai-video");
  });
});

describe("renderRouted", () => {
  it("renders with the routed renderer and reports its cost", async () => {
    const set: RendererSet = { "ai-video": fake("ai-video"), blender: fake("blender") };
    const out = await renderRouted(row(), ctx(), set);
    expect(out).toMatchObject({ renderer: "ai-video", costUsd: 0.3, routing: { renderer: "ai-video" } });
    expect(out.fellBackFrom).toBeUndefined();
    expect(set.blender!.render).not.toHaveBeenCalled();
  });
  it("falls back from Blender to AI video when Blender is missing, and says so", async () => {
    const set: RendererSet = { blender: fake("blender", { available: async () => false }), "ai-video": fake("ai-video") };
    const out = await renderRouted(row({ source: "packshot" }), ctx(), set);
    expect(out).toMatchObject({ renderer: "ai-video", fellBackFrom: "blender" });
  });
  it("falls back when Blender reports itself unavailable mid-render (no product photo)", async () => {
    const set: RendererSet = { blender: fake("blender", { render: async () => { throw new RendererUnavailable("blender", "no product photo"); } }), "ai-video": fake("ai-video") };
    expect((await renderRouted(row({ renderer: "blender" }), ctx(), set)).fellBackFrom).toBe("blender");
  });
  it("does not fall back to AI video without a keyframe or prompt (no surprise spend)", async () => {
    const set: RendererSet = { blender: fake("blender", { available: async () => false }), "ai-video": fake("ai-video") };
    await expect(renderRouted(row({ renderer: "blender" }), ctx({ firstFrame: undefined, prompt: undefined }), set)).rejects.toBeInstanceOf(RendererUnavailable);
    expect(set["ai-video"]!.render).not.toHaveBeenCalled();
  });
  it("does not reroute a real render error to another paid renderer", async () => {
    const set: RendererSet = { blender: fake("blender", { render: async () => { throw new Error("blender crashed"); } }), "ai-video": fake("ai-video") };
    await expect(renderRouted(row({ renderer: "blender" }), ctx(), set)).rejects.toThrow("blender crashed");
    expect(set["ai-video"]!.render).not.toHaveBeenCalled();
  });
  it("remotion has no fallback", async () => {
    const set: RendererSet = { remotion: fake("remotion", { available: async () => false }), "ai-video": fake("ai-video") };
    await expect(renderRouted(row({ graphic: true }), ctx(), set)).rejects.toThrow(/remotion/);
  });
});

describe("concrete renderers", () => {
  it("ai-video passes the shot's model, keyframe, seconds and no audio to the provider and returns its cost", async () => {
    const generate = vi.fn(async () => ({ url: "https://x/y.mp4", usage: { costUsd: 0.5 } })) as never;
    const r = aiVideoRenderer({ defaultModel: "fal:default", generate, pricePerSec: () => 0.1 });
    expect(r.estimateUsd(row({ seconds: 5 }), ctx())).toBeCloseTo(0.5);
    const out = await r.render(row({ model: "fal:seedance" }), ctx({ resolution: "480p" }));
    expect(out).toEqual({ url: "https://x/y.mp4", costUsd: 0.5 });
    expect(generate).toHaveBeenCalledWith("fal:seedance", "p", { firstFrame: "data:image/png;base64,BBBB", seconds: 4, audio: false, resolution: "480p", aspect: "9:16" });
  });
  it("ai-video ignores blender:/remotion: model ids and uses the default", async () => {
    const generate = vi.fn(async () => ({ url: "u", usage: { costUsd: 0 } })) as never;
    await aiVideoRenderer({ defaultModel: "fal:default", generate }).render(row({ model: "blender:packshot" }), ctx());
    expect((generate as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("fal:default");
  });
  it("blender is free, needs a product photo, and is unavailable under vitest by default", async () => {
    const clip = vi.fn(async () => "data:video/mp4;base64,Zg==");
    const r = blenderRenderer({ clip, available: async () => true });
    expect(r.estimateUsd(row(), ctx())).toBe(0);
    expect(await r.render(row(), ctx())).toEqual({ url: "data:video/mp4;base64,Zg==", costUsd: 0 });
    await expect(r.render(row(), ctx({ refs: [] }))).rejects.toBeInstanceOf(RendererUnavailable);
    expect(await blenderRenderer().available()).toBe(false);
  });
  it("remotion returns the card as an mp4 data URL", async () => {
    const r = remotionRenderer({ enabled: () => true, card: async (_r, _c, out) => { const fs = await import("node:fs/promises"); await fs.writeFile(out, "mp4"); return out; } });
    const out = await r.render(row({ graphic: true, onScreen: "OLIPOP" }), ctx());
    expect(out.url).toBe(`data:video/mp4;base64,${Buffer.from("mp4").toString("base64")}`);
    expect(await remotionRenderer({ enabled: () => false }).available()).toBe(false);
  });
});

describe("rowFromShot", () => {
  it("adapts a Shot, preferring the spec's camera and lens", () => {
    const s = { id: "s2", beat: "cta", seconds: 3, visual: "v", expectedVisual: "ev", camera: "pan 35mm", vo: "", status: "planned", source: "packshot", model: "blender:packshot", spec: { lensMm: 85, cameraMove: "slow orbit", lighting: "rim", subject: "", productFraming: "", setting: "", motionBeats: [], negative: [] } } as Shot;
    expect(rowFromShot(s)).toMatchObject({ id: "s2", action: "ev", camera: "slow orbit", lensMm: 85, lighting: "rim", source: "packshot", model: "blender:packshot" });
    expect(rowFromShot({ ...s, spec: undefined }).lensMm).toBe(35);
  });
});
