import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { diversityScores } from "@/lib/pipeline";
import { sha256, verifyStripe } from "@/lib/signals";

describe("diversity", () => {
  it("scores identical prompts as not distinct and different prompts as distinct", () => {
    const [a, b, c] = diversityScores(["red shoe on beach sunset", "red shoe on beach sunset", "founder talking in office about pricing"]);
    expect(a).toBe(0);
    expect(b).toBe(0);
    expect(c).toBeGreaterThan(0.8);
  });
});

describe("signals", () => {
  it("normalises and hashes identifiers", async () => {
    expect(await sha256(" Test@Example.com ")).toBe(crypto.createHash("sha256").update("test@example.com").digest("hex"));
  });
  it("verifies Stripe signatures and rejects bad ones", async () => {
    const secret = "whsec_test";
    const body = JSON.stringify({ id: "evt_1" });
    const t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    expect(await verifyStripe(body, `t=${t},v1=${sig}`, secret)).toBe(true);
    expect(await verifyStripe(body, `t=${t},v1=${"0".repeat(64)}`, secret)).toBe(false);
    const old = t - 3600;
    const oldSig = crypto.createHmac("sha256", secret).update(`${old}.${body}`).digest("hex");
    expect(verifyStripe(body, `t=${old},v1=${oldSig}`, secret)).toBe(false);
  });
});
