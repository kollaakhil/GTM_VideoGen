import type { Caps, ModelEntry, RegProvider, Stage } from "./types";

/** What the browser needs to draw one picker row; JSON-safe and free of env values. */
export interface ClientModel {
  id: string;
  label: string;
  provider: RegProvider;
  stages: Stage[];
  family: string;
  caps: Caps;
  cost: ModelEntry["cost"];
  env: string | null;
  verified: "yes" | "snapshot" | "local" | "no";
  ready: boolean;
  /** Why a model is disabled: missing key, no adapter, unverified. */
  reason?: string;
  note?: string;
}

export const PROVIDER_LABEL: Record<RegProvider, string> = {
  openrouter: "OpenRouter",
  fal: "fal",
  higgsfield: "Higgsfield API",
  hfmcp: "Higgsfield",
  huggingface: "Hugging Face",
  "local-blender": "Blender (this Mac)",
  "local-remotion": "Remotion (this Mac)",
  "local-synth": "Local synth",
};

export function costLabel(c: ModelEntry["cost"]): string {
  const money = (n: number) => `$${n < 0.01 ? n.toFixed(3) : n < 1 ? n.toFixed(2) : n.toFixed(2)}`;
  switch (c.unit) {
    case "free": return "free";
    case "credits": return "Higgsfield credits";
    case "per_sec": return `~${money(c.usd)}/s`;
    case "per_image": return `~${money(c.usd)}/image`;
    case "per_clip": return `~${money(c.usd)}/clip`;
    case "per_asset": return `~${money(c.usd)}/asset`;
    case "per_1k_chars": return `~${money(c.usd)}/1k chars`;
    case "per_mtok": return `$${c.usd}/$${c.usdOut ?? c.usd} per Mtok`;
  }
}

/** Short badges: Open source, 3D, World, Audio, I2V… */
export function badgesFor(m: Pick<ClientModel, "caps" | "provider">): string[] {
  const b: string[] = [];
  if (m.caps.openSource) b.push("Open source");
  if (m.caps.worldModel) b.push("World model");
  if (m.caps.threeD) b.push("3D");
  if (m.caps.audioOut) b.push("Audio");
  if (m.caps.i2v && m.caps.t2v) b.push("I2V + T2V");
  else if (m.caps.i2v) b.push("I2V");
  else if (m.caps.t2v) b.push("T2V");
  if (m.caps.maxSeconds) b.push(`${m.caps.maxSeconds}s max`);
  return b;
}
