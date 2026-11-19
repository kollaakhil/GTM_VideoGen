import { describe, expect, it } from "vitest";
import { kitJob, renderKit } from "@/lib/render/blender-kit";
import { parseSheet } from "@/lib/shot-sheet";

// Opt-in: BLENDER_KIT=1 vitest run tests/blender-kit.test.ts (launches real Blender, free, ~1 min).
describe.skipIf(process.env.BLENDER_KIT !== "1")("real Blender kit render", () => {
  const r = parseSheet({ version: 1, targetSec: 6, audioMode: "foley", palette: "#ff5e00", rules: [], endCard: { title: "T" }, shots: [
    { id: "a", n: 1, start: 0, end: 0.5, shotType: "ECU", framing: "macro", camera: { angle: "eye level", move: "slow push-in 10%", lensMm: 100 }, subject: "brass toggle switch", action: "snaps down, gas ignites", lighting: "neon", text: null, audio: {}, engine: "blender", blender: { template: "lab", label: "HIGH THINKING", ignite: 0.1 } },
    { id: "b", n: 2, start: 0.5, end: 1, shotType: "ECU", framing: "macro", camera: { angle: "low", move: "slow push-in 10%", lensMm: 100 }, subject: "titanium plate", action: "camera pushes", lighting: "rim", text: null, audio: {}, engine: "blender", blender: { template: "macro_label", label: "#1 CODING INDEX" } },
    { id: "c", n: 3, start: 1, end: 1.5, shotType: "MCU", framing: "hero", camera: { angle: "eye level", move: "slow push-in 15%", lensMm: 85 }, subject: "neon sign", action: "strikes on", lighting: "neon", text: null, audio: {}, engine: "blender", blender: { template: "glow_word", word: "GEMINI 4 NEON", ignite: 0.1 } },
  ] });
  it("renders lab, macro_label and glow_word clips without a product photo", async () => {
    if (!r.ok) throw new Error(r.error);
    for (const s of r.sheet.shots) {
      const url = await renderKit(kitJob(s, r.sheet, { width: 320, height: 180, mode: "preview" }), { mode: "preview" });
      expect(url.startsWith("data:video/mp4;base64,")).toBe(true);
      expect(url.length).toBeGreaterThan(2000);
    }
  }, 300_000);
});
