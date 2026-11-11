import { describe, expect, it, beforeAll } from "vitest";
import { assertPublicUrl, isPrivateIp } from "@/lib/safe-fetch";
import { rateLimit } from "@/lib/rate-limit";
import { createSession, safeEqual, verifySession } from "@/lib/auth";

describe("SSRF guard", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"])(
    "treats %s as private",
    (ip) => expect(isPrivateIp(ip)).toBe(true),
  );
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700::1111"])("treats %s as public", (ip) => expect(isPrivateIp(ip)).toBe(false));

  it.each([
    "http://localhost/",
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/",
    "file:///etc/passwd",
    "ftp://example.com",
    "http://user:pass@example.com",
    "http://example.com:8080",
    "http://metadata.google.internal/",
  ])("rejects %s", async (url) => {
    await expect(assertPublicUrl(url)).rejects.toThrow();
  });
});

describe("rate limit", () => {
  it("blocks after the limit within the window and recovers after it", () => {
    const key = `t-${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(rateLimit(key, 3, 1000, 1000 + i)).toBe(true);
    expect(rateLimit(key, 3, 1000, 1500)).toBe(false);
    expect(rateLimit(key, 3, 1000, 2600)).toBe(true);
  });
});

describe("sessions", () => {
  beforeAll(() => {
    process.env.SESSION_SECRET = "x".repeat(40);
  });
  it("round-trips a signed session", async () => {
    const token = await createSession("a@b.co");
    expect(await verifySession(token)).toEqual({ email: "a@b.co" });
  });
  it("rejects tampered or missing tokens", async () => {
    const token = await createSession("a@b.co");
    expect(await verifySession(token.slice(0, -2) + "xx")).toBeNull();
    expect(await verifySession(undefined)).toBeNull();
    expect(await verifySession("garbage")).toBeNull();
  });
  it("compares secrets safely", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
