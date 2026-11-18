import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { higgsfieldCredits, higgsfieldDisconnect, higgsfieldExchange, higgsfieldMcpStatus, higgsfieldVideoCost } from "@/lib/higgsfield-mcp";
import type { Integration } from "@/lib/types";

const mock = vi.hoisted(() => ({ connection: null as Integration | null }));
vi.mock("@/lib/store", () => ({
  get: async () => structuredClone(mock.connection),
  put: async (_table: string, row: Integration) => { mock.connection = structuredClone(row); },
}));

const callback = "https://studio.example.com/api/higgsfield/callback";
const expired = () => Response.json({ error: "invalid_grant", error_description: "Raw provider diagnostics" }, { status: 400 });

function setup({ expiresIn = 1, refresh = () => Response.json({ access_token: "fresh-access", refresh_token: "rotated" }), staleSession = false, rejectOldAccess = false } = {}) {
  const grants: string[] = [];
  const initializations: string[] = [];
  let failSession = staleSession;
  const fetchMock = vi.fn(async (url: string, options: RequestInit) => {
    if (url.endsWith("/register")) return Response.json({ client_id: "test-client" });
    if (url.endsWith("/token")) {
      const body = options.body as URLSearchParams;
      if (body.get("grant_type") === "authorization_code") {
        return Response.json({ access_token: "old-access", refresh_token: "original", expires_in: expiresIn });
      }
      grants.push(body.get("refresh_token")!);
      return refresh();
    }
    const auth = new Headers(options.headers).get("authorization")!;
    if (rejectOldAccess && auth === "Bearer old-access") return new Response(null, { status: 401 });
    const { id, method, params } = JSON.parse(options.body as string);
    if (method === "initialize") {
      initializations.push(auth);
      return Response.json({ id, result: {} }, { headers: { "mcp-session-id": `session-${id}` } });
    }
    if (method === "notifications/initialized") return new Response(null, { status: 202 });
    if (failSession) {
      failSession = false;
      return new Response(null, { status: 404 });
    }
    if (params.name === "generate_video") expect(params.arguments.params.get_cost).toBe(true);
    return Response.json({ id, result: { structuredContent: { credits: params.name === "balance" ? 9 : 2 } } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { grants, initializations, fetchMock };
}

beforeEach(() => { mock.connection = null; });
afterEach(async () => {
  await higgsfieldDisconnect();
  vi.unstubAllGlobals();
});

describe("Higgsfield MCP sign-in", () => {
  it("shares a rotating token refresh across concurrent draft preflight requests", async () => {
    const { grants, initializations } = setup();
    await higgsfieldExchange("code", "verifier", callback);
    expect(await Promise.all([
      higgsfieldCredits(),
      ...Array.from({ length: 4 }, () => higgsfieldVideoCost("seedance1_5", { seconds: 4, resolution: "480p" })),
    ])).toEqual([9, 2, 2, 2, 2]);
    expect(grants).toEqual(["original"]);
    expect(new Set(initializations)).toEqual(new Set(["Bearer fresh-access"]));
    expect((await higgsfieldMcpStatus()).connected).toBe(true);
  });

  it("clears a rejected grant and gives an actionable error without returning provider diagnostics", async () => {
    const { grants, initializations } = setup({ refresh: expired });
    await higgsfieldExchange("code", "verifier", callback);
    await expect(higgsfieldCredits()).rejects.toThrow("Open Connections and reconnect your Higgsfield account");
    expect((await higgsfieldMcpStatus()).connected).toBe(false);
    expect(mock.connection?.accessToken).toBeUndefined();
    expect(mock.connection?.clients[callback]).toBe("test-client");
    await expect(higgsfieldCredits()).rejects.toThrow("Higgsfield isn't connected");
    expect(grants).toEqual(["original"]);
    expect(initializations).toHaveLength(0);
  });

  it("starts a fresh MCP session after a 404 without refreshing OAuth", async () => {
    const { grants, initializations } = setup({ expiresIn: 3600, staleSession: true });
    await higgsfieldExchange("code", "verifier", callback);
    await expect(higgsfieldCredits()).resolves.toBe(9);
    expect(initializations).toEqual(["Bearer old-access", "Bearer old-access"]);
    expect(grants).toHaveLength(0);
  });

  it("refreshes only once after concurrent 401s using the same rejected access token", async () => {
    const { grants } = setup({ expiresIn: 3600, rejectOldAccess: true });
    await higgsfieldExchange("code", "verifier", callback);
    await expect(Promise.all([higgsfieldCredits(), higgsfieldCredits()])).resolves.toEqual([9, 9]);
    expect(grants).toEqual(["original"]);
  });
});
