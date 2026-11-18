import crypto from "node:crypto";
import { get, put } from "./store";
import type { Integration } from "./types";

/**
 * Higgsfield's official MCP server, signed in with the user's Higgsfield account (OAuth + PKCE),
 * so generations spend the account's subscription credits instead of separate API credits.
 */
export const PKCE_COOKIE = "gtm_hf_pkce";

export function appOrigin(req: { headers: Headers; nextUrl: URL }) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
}

const MCP_URL = "https://mcp.higgsfield.ai/mcp";
const AUTH = "https://mcp.higgsfield.ai/oauth2";
const ROW = "higgsfield_mcp";
const SCOPE = "openid email offline_access";
const RECONNECT = "Higgsfield sign-in is no longer valid. Open Connections and reconnect your Higgsfield account.";

const key = () => crypto.createHash("sha256").update(process.env.SESSION_SECRET ?? "").digest();
function seal(s: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const out = Buffer.concat([c.update(s, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), out].map((b) => b.toString("base64url")).join(".");
}
function open(s: string) {
  const [iv, tag, data] = s.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

const row = async (): Promise<Integration> => (await get("integrations", ROW)) ?? { id: ROW, createdAt: new Date().toISOString(), clients: {} };

export async function higgsfieldMcpStatus() {
  const r = await get("integrations", ROW);
  return { connected: !!r?.refreshToken, email: r?.email, connectedAt: r?.connectedAt };
}

async function clientFor(redirectUri: string) {
  const r = await row();
  if (r.clients[redirectUri]) return r.clients[redirectUri];
  const res = await fetch(`${AUTH}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "GTM Engine", redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none", scope: SCOPE }),
  });
  if (!res.ok) throw new Error(`Higgsfield client registration ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { client_id } = (await res.json()) as { client_id: string };
  r.clients[redirectUri] = client_id;
  await put("integrations", r);
  return client_id;
}

/** Returns the Higgsfield sign-in URL plus the PKCE verifier/state to keep in a short-lived cookie. */
export async function higgsfieldAuthorizeUrl(redirectUri: string) {
  const clientId = await clientFor(redirectUri);
  const verifier = crypto.randomBytes(32).toString("base64url");
  const state = crypto.randomBytes(16).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: SCOPE, state, code_challenge: challenge, code_challenge_method: "S256", resource: MCP_URL });
  return { url: `${AUTH}/authorize?${q}`, verifier, state };
}

class InvalidGrant extends Error {}

async function token(params: Record<string, string>) {
  const res = await fetch(`${AUTH}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...params, resource: MCP_URL }) });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (body?.error === "invalid_grant") {
      throw new InvalidGrant(params.grant_type === "refresh_token" ? RECONNECT : "Higgsfield sign-in expired or was already used. Start sign-in again from Connections.");
    }
    throw new Error(`Higgsfield sign-in failed (HTTP ${res.status}). Try again from Connections.`);
  }
  return (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number; id_token?: string };
}

function emailOf(idToken?: string) {
  try {
    return idToken ? (JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString()).email as string) : undefined;
  } catch {
    return undefined;
  }
}

async function save(t: Awaited<ReturnType<typeof token>>, r: Integration) {
  r.accessToken = seal(t.access_token);
  if (t.refresh_token) r.refreshToken = seal(t.refresh_token);
  r.expiresAt = Date.now() + (t.expires_in ?? 3600) * 1000;
  r.email = emailOf(t.id_token) ?? r.email;
  await put("integrations", r);
}

export async function higgsfieldExchange(code: string, verifier: string, redirectUri: string) {
  const clientId = await clientFor(redirectUri);
  const t = await token({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri, client_id: clientId });
  if (!t.refresh_token) throw new Error("Higgsfield didn't grant ongoing access. Reconnect and allow offline access.");
  const r = await row();
  r.clientId = clientId;
  r.connectedAt = new Date().toISOString();
  delete r.email;
  sessions.clear();
  await save(t, r);
}

async function clearCredentials(r: Integration) {
  delete r.accessToken;
  delete r.refreshToken;
  delete r.expiresAt;
  delete r.email;
  delete r.connectedAt;
  sessions.clear();
  await put("integrations", r);
}

export async function higgsfieldDisconnect() {
  await clearCredentials(await row());
}

const cachedToken = (r: Integration | null) =>
  r?.refreshToken && r.accessToken && (r.expiresAt ?? 0) > Date.now() + 60_000 ? open(r.accessToken) : undefined;

let refreshing: Promise<string> | undefined;

async function refreshAccessToken(rejected?: string) {
  const r = await get("integrations", ROW);
  if (!r?.refreshToken || !r.clientId) throw new Error("Higgsfield isn't connected. Open Connections and click Connect Higgsfield account.");
  const cached = cachedToken(r);
  if (cached && cached !== rejected) return cached;

  const refresh = r.refreshToken;
  const t = await token({ grant_type: "refresh_token", refresh_token: open(refresh), client_id: r.clientId }).catch((error) => {
    if (error instanceof InvalidGrant) return null;
    throw error;
  });
  const latest = await get("integrations", ROW);
  if (latest?.refreshToken !== refresh) {
    const newer = cachedToken(latest);
    if (newer && newer !== rejected) return newer;
    throw new Error(RECONNECT);
  }
  if (!t) {
    await clearCredentials(latest);
    throw new Error(RECONNECT);
  }
  if (latest.accessToken) sessions.delete(open(latest.accessToken));
  await save(t, latest);
  return t.access_token;
}

function accessToken(rejected?: string) {
  return refreshing ??= refreshAccessToken(rejected).finally(() => { refreshing = undefined; });
}

let rpcId = 0;
const sessions = new Map<string, string>();

async function post(body: unknown, auth: string, session?: string) {
  return fetch(MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${auth}`, "mcp-protocol-version": "2025-06-18", ...(session ? { "mcp-session-id": session } : {}) },
    body: JSON.stringify(body),
  });
}

async function readRpc(res: Response, id: number) {
  const text = await res.text();
  if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) return JSON.parse(text);
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const msg = JSON.parse(line.slice(5));
    if (msg.id === id) return msg;
  }
  throw new Error("Higgsfield MCP: no response");
}

/** One JSON-RPC call over MCP Streamable HTTP, with initialize + token refresh handled. */
async function rpc(method: string, params: Record<string, unknown>, retry?: { rejected?: string }): Promise<unknown> {
  const auth = await accessToken(retry?.rejected);
  let session = sessions.get(auth);
  if (!session) {
    const id = ++rpcId;
    const init = await post({ jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "gtm-engine", version: "1.0" } } }, auth);
    if (init.status === 401) {
      if (!retry) return rpc(method, params, { rejected: auth });
      throw new Error(RECONNECT);
    }
    if (!init.ok) throw new Error(`Higgsfield MCP ${init.status}: ${(await init.text()).slice(0, 200)}`);
    await readRpc(init, id);
    session = init.headers.get("mcp-session-id") ?? "";
    sessions.set(auth, session);
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }, auth, session || undefined);
  }
  const id = ++rpcId;
  const res = await post({ jsonrpc: "2.0", id, method, params }, auth, session || undefined);
  if (res.status === 401 || res.status === 404) {
    sessions.delete(auth);
    if (!retry) return rpc(method, params, res.status === 401 ? { rejected: auth } : {});
    if (res.status === 401) throw new Error(RECONNECT);
  }
  if (!res.ok) throw new Error(`Higgsfield MCP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const msg = await readRpc(res, id);
  if (msg.error) throw new Error(`Higgsfield MCP: ${msg.error.message}`);
  return msg.result;
}

export type McpTool = { name: string; description?: string; inputSchema?: Record<string, unknown> };
export const higgsfieldTools = async () => ((await rpc("tools/list", {})) as { tools: McpTool[] }).tools;

export type McpContent = { type: string; text?: string; data?: string; mimeType?: string; resource?: { uri?: string; text?: string } };
export async function higgsfieldCall(name: string, args: Record<string, unknown>) {
  const r = (await rpc("tools/call", { name, arguments: args })) as { content?: McpContent[]; structuredContent?: unknown; isError?: boolean };
  if (r.isError) throw new Error(`Higgsfield: ${(r.content ?? []).map((c) => c.text).join(" ").slice(0, 300) || "tool error"}`);
  return r;
}

/** Tool results arrive as structuredContent or as JSON inside text; read both. */
function payload(r: { content?: McpContent[]; structuredContent?: unknown }): unknown[] {
  const out: unknown[] = r.structuredContent ? [r.structuredContent] : [];
  for (const c of r.content ?? []) {
    const t = c.text ?? c.resource?.text;
    if (!t) continue;
    const i = t.search(/[[{]/);
    try {
      out.push(i >= 0 ? JSON.parse(t.slice(i)) : t);
    } catch {
      out.push(t);
    }
  }
  return out;
}

/** First value (depth-first) whose key matches and passes the check. */
export function pick(o: unknown, keys: RegExp, ok: (v: unknown) => boolean = (v) => typeof v === "string" && !!v): string | undefined {
  if (Array.isArray(o)) {
    for (const x of o) {
      const v = pick(x, keys, ok);
      if (v) return v;
    }
  } else if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o)) if (keys.test(k) && ok(v)) return String(v);
    for (const v of Object.values(o)) {
      const f = pick(v, keys, ok);
      if (f) return f;
    }
  }
  return undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown) => typeof v === "string" && UUID.test(v);
const isHttps = (v: unknown) => typeof v === "string" && v.startsWith("https://");
const isVideoUrl = (v: unknown) => isHttps(v) && /\.(mp4|mov|webm)(\?|$)/i.test(String(v));

export async function higgsfieldCredits(): Promise<number | null> {
  const n = Number(pick(payload(await higgsfieldCall("balance", {})), /^credits$/, (v) => typeof v === "number"));
  return Number.isFinite(n) ? n : null;
}

async function uploadImage(dataUrl: string) {
  const m = /^data:(image\/(png|jpe?g|webp));base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("Higgsfield needs the first frame as a PNG, JPEG or WebP image");
  const up = payload(await higgsfieldCall("media_upload", { filename: `frame.${m[2] === "jpeg" ? "jpg" : m[2]}`, content_type: m[1] }));
  const url = pick(up, /upload_?url/i, isHttps);
  const id = pick(up, /^(media_?id|id)$/i, isUuid);
  if (!url || !id) throw new Error("Higgsfield upload: no upload URL returned");
  const put = await fetch(url, { method: "PUT", headers: { "content-type": m[1] }, body: Buffer.from(m[3], "base64") });
  if (!put.ok) throw new Error(`Higgsfield upload failed (${put.status})`);
  await higgsfieldCall("media_confirm", { type: "image", media_id: id });
  return id;
}

export type HfVideoOpts = { firstFrame?: string; seconds?: number; resolution?: string; aspect?: string };
const videoParams = (model: string, prompt: string, o: HfVideoOpts) => ({
  model,
  prompt,
  ...(o.seconds ? { duration: Math.round(o.seconds) } : {}),
  ...(o.resolution ? { resolution: o.resolution } : {}),
  aspect_ratio: o.aspect ?? "9:16",
  use_unlim: false,
});

/** Credits a generation would cost, without submitting anything. */
export async function higgsfieldVideoCost(model: string, o: HfVideoOpts): Promise<number | null> {
  const r = payload(await higgsfieldCall("generate_video", { params: { ...videoParams(model, "cost check", o), get_cost: true }, context: "Cost preflight for a storyboard shot" }));
  const n = Number(pick(r, /^credits(_exact)?$/, (v) => typeof v === "number"));
  return Number.isFinite(n) ? n : null;
}

/** One image-to-video shot on the user's Higgsfield credits; returns the finished video URL. */
export async function higgsfieldMcpVideo(model: string, prompt: string, o: HfVideoOpts, timeoutMs = 12 * 60_000) {
  const medias = o.firstFrame ? [{ value: await uploadImage(o.firstFrame), role: "start_image" }] : undefined;
  const sub = payload(await higgsfieldCall("generate_video", { params: { ...videoParams(model, prompt, o), ...(medias ? { medias } : {}) }, context: "Render one approved storyboard shot of a product ad" }));
  const jobId = pick(sub, /^(job_?id|jobId|id)$/i, isUuid);
  if (!jobId) throw new Error(`Higgsfield didn't start the video: ${JSON.stringify(sub).slice(0, 240)}`);
  const credits = Number(pick(sub, /^credits(_exact)?$/, (v) => typeof v === "number")) || null;
  const started = Date.now();
  for (;;) {
    const st = payload(await higgsfieldCall("job_status", { jobId, sync: true }));
    const status = (pick(st, /^status$/i) ?? "").toLowerCase();
    const url = pick(st, /url/i, isVideoUrl);
    if (url && /complet|succe|done|finish/.test(status || "completed")) return { url, credits, jobId };
    if (/fail|nsfw|cancel|error|reject/.test(status)) throw new Error(`Higgsfield ${status}: ${(pick(st, /reason|error|message/i) ?? "").slice(0, 200)} (credits are refunded on failure)`);
    if (Date.now() - started > timeoutMs) throw new Error(`Higgsfield video timed out (job ${jobId})`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}
