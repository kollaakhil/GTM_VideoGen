import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findBlender, inferTemplate, lightingFrom, renderBlenderScene, sceneArgs, sceneAvailable, sceneSize } from "@/lib/render/blender-scene";
import { aiVideoRenderer, blenderRenderer, slots } from "@/lib/render/renderers";
import { renderRouted } from "@/lib/render/router";
import { rowFromSheetShot, type RenderContext, type ShotRow } from "@/lib/render/types";
import { parseSheet } from "@/lib/shot-sheet";

const row = (o: Partial<ShotRow> = {}): ShotRow => ({ id: "s1", beat: "hook", seconds: 3, action: "can on black", camera: "slow push-in", ...o });
const ctx = (o: Partial<RenderContext> = {}): RenderContext => ({ mode: "preview", width: 1080, height: 1920, refs: ["data:image/png;base64,AAAA"], firstFrame: "data:image/png;base64,BB", prompt: "p", ...o });

describe("template and look inference from the shot row", () => {
  it("maps the camera column to one of the four templates", () => {
    expect(inferTemplate(row())).toBe("push-in");
    expect(inferTemplate(row({ camera: "slow 40° orbit around the can" }))).toBe("orbit");
    expect(inferTemplate(row({ camera: "locked-off macro on the label" }))).toBe("macro");
    expect(inferTemplate(row({ camera: "rack focus from the glow to the label" }))).toBe("rack-focus");
    expect(inferTemplate(row({ camera: "orbit", template: "macro" }))).toBe("macro");
  });
  it("reads the light and its colour from the lighting column", () => {
    expect(lightingFrom("cyan neon tube practical in the back")).toEqual({ light: "practical", accent: "#19e6ff" });
    expect(lightingFrom("hard rim light from behind")).toMatchObject({ light: "rim" });
    expect(lightingFrom("rim light plus a magenta glowing sign")).toEqual({ light: "both", accent: "#ff2bd6" });
    expect(lightingFrom("").light).toBe("both");
  });
});

describe("render arguments", () => {
  it("preview is 720p on the short side, final keeps the requested size", () => {
    expect(sceneSize("preview", 1080, 1920)).toEqual({ width: 720, height: 1280 });
    expect(sceneSize("preview", 1920, 1080)).toEqual({ width: 1280, height: 720 });
    expect(sceneSize("final", 1080, 1920)).toEqual({ width: 1080, height: 1920 });
  });
  it("passes camera template, lens (clamped), light and mode through to scene.py", () => {
    const a = sceneArgs(row({ camera: "orbit", lensMm: 35, lighting: "cyan neon tube" }), { mode: "preview", width: 1080, height: 1920 }, "/t/p.png", "/t/out");
    expect(a).toContain("--template"); expect(a[a.indexOf("--template") + 1]).toBe("orbit");
    expect(a[a.indexOf("--lens") + 1]).toBe("35");
    expect(a[a.indexOf("--width") + 1]).toBe("720");
    expect(a[a.indexOf("--light") + 1]).toBe("practical");
    expect(a[a.indexOf("--accent") + 1]).toBe("#19e6ff");
    expect(a[a.indexOf("--image") + 1]).toBe("/t/p.png");
    expect(sceneArgs(row({ lensMm: 400 }), { mode: "final", width: 1080, height: 1920 }, null, "/o")).toContain("135");
    expect(sceneArgs(row(), { mode: "final", width: 1080, height: 1920, at: 0.5 }, null, "/o")).toEqual(expect.arrayContaining(["--at", "0.5"]));
    expect(sceneArgs(row({ camera: "macro" }), { mode: "preview", width: 1, height: 1 }, null, "/o")[sceneArgs(row({ camera: "macro" }), { mode: "preview", width: 1, height: 1 }, null, "/o").indexOf("--lens") + 1]).toBe("100");
  });
});

describe("Blender missing", () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  it("findBlender returns null when no candidate exists, and honours BLENDER_BIN", async () => {
    expect(await findBlender({}, ["/nope/blender"])).toBeNull();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bl-"));
    const fake = path.join(dir, "blender");
    await fs.writeFile(fake, "#!/bin/sh\n", { mode: 0o755 });
    expect(await findBlender({ BLENDER_BIN: fake }, [])).toBe(fake);
    await fs.rm(dir, { recursive: true });
  });
  it("is off under vitest, and renderBlenderScene says unavailable instead of crashing", async () => {
    vi.stubEnv("BLENDER_SCENES", "0"); // even when the opt-in real-Blender run sets BLENDER_SCENES=1
    expect(await sceneAvailable()).toBe(false);
    await expect(renderBlenderScene(row(), { mode: "preview", width: 100, height: 100 })).rejects.toMatchObject({ name: "RendererUnavailable" });
  });
  it("the router falls back to AI video when the Blender scene is unavailable", async () => {
    vi.stubEnv("BLENDER_SCENES", "0");
    const generated: string[] = [];
    const out = await renderRouted(row({ renderer: "blender" }), ctx(), {
      blender: blenderRenderer({ available: async () => true }), // claims to be up, then finds no Blender while rendering
      "ai-video": aiVideoRenderer({ defaultModel: "fal:x", generate: (async (m: string) => { generated.push(m); return { url: "u", usage: { costUsd: 0.2 } }; }) as never }),
    });
    expect(out).toMatchObject({ renderer: "ai-video", fellBackFrom: "blender", costUsd: 0.2 });
    expect(generated).toEqual(["fal:x"]);
  });
});

describe("Blender queue", () => {
  it("runs at most `limit` renders at once and releases the slot when one fails", async () => {
    const run = slots(1);
    let live = 0, peak = 0;
    const job = (fail = false) => run(async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 5)); live--; if (fail) throw new Error("x"); return "ok"; });
    const out = await Promise.allSettled([job(), job(true), job(), job()]);
    expect(peak).toBe(1);
    expect(out.map((o) => o.status)).toEqual(["fulfilled", "rejected", "fulfilled", "fulfilled"]);
  });
});

describe("shot sheet rows", () => {
  const sheet = (engine: string, locked: boolean) => {
    const r = parseSheet({ version: 1, targetSec: 8, audioMode: "foley", rules: [], endCard: { title: "T" }, shots: [{
      id: "a", n: 1, start: 1, end: 3.5, shotType: "macro", camera: { angle: "eye level", move: "slow push-in", lensMm: 100 }, subject: "label", action: "droplets run",
      lighting: "magenta neon practical", text: { copy: "Gemini 4" }, audio: { sfx: "valve clank" }, engine, engineLocked: locked }] });
    if (!r.ok) throw new Error(r.error);
    return r.sheet.shots[0];
  };
  it("adapts timings, camera, lens, text and sound", () => {
    const r = rowFromSheetShot(sheet("blender", false));
    expect(r).toMatchObject({ id: "a", seconds: 2.5, lensMm: 100, camera: "eye level, slow push-in", onScreen: "Gemini 4", sound: "valve clank", renderer: "blender" });
  });
  it("the sheet's engine decides the renderer, locked or not (the sheet is the source of truth)", () => {
    expect(rowFromSheetShot(sheet("blender", true)).renderer).toBe("blender");
    expect(rowFromSheetShot(sheet("blender", false)).renderer).toBe("blender");
    expect(rowFromSheetShot(sheet("ai_video", true)).renderer).toBe("ai-video");
    expect(rowFromSheetShot(sheet("remotion", false))).toMatchObject({ renderer: "remotion", graphic: true });
  });
});

// Opt-in: BLENDER_SCENES=1 vitest run tests/blender-scene.test.ts (launches real Blender, ~20 s).
describe.skipIf(process.env.BLENDER_SCENES !== "1")("real Blender render", () => {
  it("renders a labelled still for each template", async () => {
    for (const camera of ["slow push-in", "orbit", "locked-off macro", "rack focus"]) {
      const url = await renderBlenderScene(row({ camera, lighting: "rim light and a magenta practical" }), { mode: "preview", width: 270, height: 480, at: 0.5 });
      expect(url.startsWith("data:image/png;base64,")).toBe(true);
      expect(url.length).toBeGreaterThan(5000);
    }
  }, 240_000);
  it("renders a short mp4 clip through the TS path", async () => {
    const url = await renderBlenderScene(row({ camera: "orbit", seconds: 0.5 }), { mode: "preview", width: 270, height: 480 });
    expect(url.startsWith("data:video/mp4;base64,")).toBe(true);
  }, 240_000);
});
