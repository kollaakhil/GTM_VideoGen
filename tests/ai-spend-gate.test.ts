import { afterEach, describe, expect, it, vi } from "vitest";
import { chatJSON, generateImage, generateVideo, musicBed, voiceover } from "@/lib/ai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateProductMesh } from "@/lib/registry/product-3d";
import { BudgetExceeded, CostMeter, withMeter } from "@/lib/render/cost-meter";

const ok = (cost: number) => new Response(JSON.stringify({ choices: [{ message: { content: "{\"a\":1}", images: [{ image_url: { url: "data:image/png;base64,AA==" } }] } }], usage: { cost } }), { status: 200 });

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("every paid call is gated server side before a request leaves", () => {
  it("chatJSON reserves, calls, and settles the reported cost", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "k");
    const fetchMock = vi.fn(async () => ok(0.004));
    vi.stubGlobal("fetch", fetchMock);
    const m = new CostMeter({ capUsd: 1 });
    const out = await withMeter(m, () => chatJSON<{ a: number }>("some/model", "s", "u"));
    expect(out.data).toEqual({ a: 1 });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(m.snapshot()).toMatchObject({ spentUsd: 0.004, reservedUsd: 0 });
  });

  it("blocks chat and image calls with no network request once the cap is spent", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "k");
    const fetchMock = vi.fn(async () => ok(0.01));
    vi.stubGlobal("fetch", fetchMock);
    const m = new CostMeter({ capUsd: 1, spentUsd: 0.99 });
    await withMeter(m, async () => {
      await expect(chatJSON("some/model", "s", "u")).rejects.toBeInstanceOf(BudgetExceeded);
      await expect(generateImage("img/model", "p")).rejects.toBeInstanceOf(BudgetExceeded);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks video, voice and music at the cap, and prices video by seconds", async () => {
    vi.stubEnv("FAL_KEY", "k");
    const fetchMock = vi.fn(async (..._a: unknown[]) => { throw new Error("network must not be reached"); });
    vi.stubGlobal("fetch", fetchMock);
    const m = new CostMeter({ capUsd: 0.5, spentUsd: 0.45 });
    await withMeter(m, async () => {
      await expect(generateVideo("fal-ai/bytedance/seedance/v1/pro/fast/image-to-video", "p", { seconds: 5, resolution: "480p" })).rejects.toThrow(/Over the run cap/);
      await expect(voiceover("x".repeat(2000))).rejects.toBeInstanceOf(BudgetExceeded); // $0.20
      await expect(musicBed("calm", 10)).rejects.toBeInstanceOf(BudgetExceeded); // $0.20
    });
    expect(m.snapshot().spentUsd).toBe(0.45);
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes("queue.fal.run"))).toBe(true);
  });

  it("is a pass-through with no meter in scope (scripts, unit tests)", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn(async () => ok(0.5)));
    await expect(chatJSON("some/model", "s", "u")).resolves.toMatchObject({ usage: { costUsd: 0.5 } });
  });

  it("the Product 3D mesh (a direct fal call) is gated too: over the cap it never reaches the provider", async () => {
    const run = vi.fn(async () => ({}));
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "mesh-gate-"));
    const m = new CostMeter({ capUsd: 0.05 });
    await withMeter(m, async () => {
      await expect(generateProductMesh({ image: "https://example.com/can.jpg", run: run as never, ready: () => true, cacheDir })).rejects.toBeInstanceOf(BudgetExceeded);
    });
    expect(run).not.toHaveBeenCalled();
    expect(m.snapshot().spentUsd).toBe(0);
    await fs.rm(cacheDir, { recursive: true, force: true });
  });
});
