import fs from "node:fs";
import type { ClientModel } from "./client";
import { CATALOG, getModel } from "./index";
import type { ModelEntry, RegProvider } from "./types";

/** Server-only: whether a provider's credentials (or local tool) are present. Never exposes the values. */
export function providerReady(p: RegProvider, env: Record<string, string | undefined> = process.env): boolean {
  switch (p) {
    case "openrouter": return !!env.OPENROUTER_API_KEY;
    case "fal": return !!env.FAL_KEY;
    case "higgsfield": return !!((env.HF_API_KEY_ID && env.HF_API_KEY_SECRET) || env.HF_API_KEY);
    // Higgsfield MCP signs in with OAuth in the app (Connections page); the call reports it clearly if that is missing.
    case "hfmcp": return true;
    case "huggingface": return !!env.HF_TOKEN;
    case "local-blender": return !!env.BLENDER_BIN || fs.existsSync("/Applications/Blender.app/Contents/MacOS/Blender");
    case "local-remotion": return true;
    case "local-synth": return true;
  }
}

export interface Readiness { ready: boolean; reason?: string }

/** Whether a picker may offer the entry: it needs an adapter and its provider's key. */
export function readiness(e: ModelEntry, env: Record<string, string | undefined> = process.env): Readiness {
  if (!e.runnable) return { ready: false, reason: e.note ?? "No adapter yet" };
  if (!providerReady(e.provider, env)) {
    return { ready: false, reason: e.env ? `Set ${e.env}` : e.provider === "local-blender" ? "Install Blender (BLENDER_BIN)" : "Not connected" };
  }
  return { ready: true };
}

export const modelReady = (id: string) => {
  const e = getModel(id);
  return e ? readiness(e).ready : false;
};

/** The whole catalog as the picker needs it, with live readiness. Server-side only (reads env). */
export function clientModels(env: Record<string, string | undefined> = process.env): ClientModel[] {
  return CATALOG.map((e) => {
    const r = readiness(e, env);
    const s = e.verify.source;
    return {
      id: e.id, label: e.label, provider: e.provider, stages: e.stages, family: e.family, caps: e.caps, cost: e.cost, env: e.env,
      verified: s === "unverified" ? "no" : s === "local" ? "local" : s === "higgsfield-mcp" ? "snapshot" : "yes",
      ready: r.ready,
      reason: r.reason ?? (s === "unverified" ? e.verify.note : undefined),
      note: e.note,
    };
  });
}
