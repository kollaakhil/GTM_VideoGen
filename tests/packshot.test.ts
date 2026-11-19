import fs from "node:fs/promises";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { PACKSHOT_MODEL, packshotAvailable, packshotShot, renderPackshot } from "@/lib/packshot";
import { specGaps } from "@/lib/shot-spec";

const cta = { id: "s3", beat: "CTA", seconds: 4, visual: "diner beside two cases", camera: "push-in", vo: "Shop at drinkolipop.com.", onScreen: "Shop at drinkolipop.com", status: "planned" as const };

describe("Blender packshot end shot", () => {
  it("keeps the beat, VO and overlay and swaps the picture for the real label", () => {
    const s = packshotShot(cta, "OLIPOP");
    expect(s).toMatchObject({ id: "s3", seconds: 4, vo: cta.vo, onScreen: cta.onScreen, source: "packshot", model: PACKSHOT_MODEL });
    expect(s.expectedVisual).toMatch(/real OLIPOP can/);
    expect(specGaps(s)).toEqual([]);
  });
  it("is off under vitest unless PACKSHOT=1", async () => {
    if (process.env.PACKSHOT === "1") return;
    expect(await packshotAvailable()).toBe(false);
  });
  it.skipIf(process.env.PACKSHOT !== "1")("renders a real still with Blender (local smoke)", async () => {
    const photo = process.env.PACKSHOT_PHOTO ?? `${os.homedir()}/agent-tools/gtm-e2e/v2/cola.jpg`;
    const url = await renderPackshot(`data:image/jpeg;base64,${(await fs.readFile(photo)).toString("base64")}`, { width: 270, height: 480, still: true });
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
  }, 120_000);
});
