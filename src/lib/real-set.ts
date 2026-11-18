import fs from "node:fs/promises";
import path from "node:path";
import { assertPublicUrl } from "./safe-fetch";
import { hasFile, run, toolPath, withTemp, writeDataUrl } from "./local-tools";
import type { Shot } from "./types";

/**
 * Optional "real set": one World Labs (Marble) world per storyboard, so every keyframe is shot in the same 3D set.
 * Blender renders a camera plate per shot from the world's panorama (matching the shot's lens and a varied angle),
 * and the plate goes to the image model as a set reference. Off unless REAL_SET=1 and WORLDLABS_API_KEY are set.
 */
const API = "https://api.worldlabs.ai/marble/v1";

export function realSetStatus(): { available: boolean; reason: string | null } {
  if (process.env.REAL_SET !== "1") return { available: false, reason: "Real set is off. Set REAL_SET=1 in .env.local to enable it." };
  if (!process.env.WORLDLABS_API_KEY) return { available: false, reason: "Add a World Labs API key (WORLDLABS_API_KEY) to build real sets. Videos render normally without it." };
  return { available: true, reason: null };
}

/** Focal length per lens id, used for the Blender camera. */
const LENS_MM: Record<string, number> = { auto: 35, wide24: 24, std35: 35, normal50: 50, portrait85: 85, macro100: 100 };

/** Approximate API cost per world (USD) for budget preflight; Marble 1.1 image worlds are well under this. */
export const REAL_SET_RESERVE = Number(process.env.WORLDLABS_COST_USD) || 1.5;

async function wl<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${pathname}`, { ...init, headers: { "Content-Type": "application/json", "WLT-Api-Key": process.env.WORLDLABS_API_KEY!, ...(init.headers ?? {}) } });
  const text = await res.text();
  if (res.status === 402) throw new Error("World Labs needs API credits for this world. No set was built.");
  if (!res.ok) throw new Error(`World Labs ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

type Operation = { operation_id: string; done: boolean; error: { message?: string } | null; response: { id?: string; world_id?: string; assets?: { imagery?: { pano_url?: string } } } | null };

/** Uploads the hero keyframe, generates a world from it and returns the world id and its panorama bytes. */
export async function buildWorld(keyframe: string, setPrompt: string, signal?: { live: () => boolean }): Promise<{ worldId: string; pano: string }> {
  const ext = /^data:image\/(png|jpeg|webp)/.exec(keyframe)?.[1]?.replace("jpeg", "jpg") ?? "png";
  const prep = await wl<{ media_asset: { id: string }; upload_info: { upload_url: string; upload_method: string; required_headers?: Record<string, string> } }>("/media-assets:prepare_upload", {
    method: "POST", body: JSON.stringify({ file_name: `keyframe.${ext}`, kind: "image", extension: ext }),
  });
  const bytes = Buffer.from(keyframe.slice(keyframe.indexOf(",") + 1), "base64");
  const up = await fetch(prep.upload_info.upload_url, { method: prep.upload_info.upload_method || "PUT", headers: prep.upload_info.required_headers ?? {}, body: bytes });
  if (!up.ok) throw new Error(`World Labs upload failed (${up.status}).`);
  const op = await wl<Operation>("/worlds:generate", {
    method: "POST",
    body: JSON.stringify({
      display_name: "GTM Engine set",
      model: process.env.WORLDLABS_MODEL || "marble-1.1",
      permission: { public: false },
      world_prompt: { type: "image", image_prompt: { source: "media_asset", media_asset_id: prep.media_asset.id }, text_prompt: setPrompt.slice(0, 1500) },
    }),
  });
  let cur = op;
  for (let i = 0; i < 120 && !cur.done; i++) {
    if (signal && !signal.live()) throw new Error("Stopped while the set was generating.");
    await new Promise((r) => setTimeout(r, 5000));
    cur = await wl<Operation>(`/operations/${op.operation_id}`);
  }
  if (!cur.done) throw new Error("World Labs did not finish the set in 10 minutes.");
  if (cur.error) throw new Error(`World Labs: ${cur.error.message ?? "generation failed"}`);
  const panoUrl = cur.response?.assets?.imagery?.pano_url;
  const worldId = cur.response?.world_id ?? cur.response?.id ?? op.operation_id;
  if (!panoUrl) throw new Error("World Labs returned no panorama for the set.");
  const res = await fetch(await assertPublicUrl(panoUrl), { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Couldn’t download the set panorama (${res.status}).`);
  const type = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  return { worldId, pano: `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}` };
}

export async function blenderAvailable() {
  return hasFile(toolPath.blender());
}

/** Camera angle per shot so plates vary like coverage: a master, then reverse and side angles. */
export function plateAngle(index: number, camera: string) {
  const yaw = [0, 35, -35, 160, 70, -70][index % 6];
  const pitch = /top-down|overhead/i.test(camera) ? -60 : /low angle/i.test(camera) ? 12 : -4;
  return { yaw, pitch };
}

/** Renders a 9:16 camera plate for one shot from the set panorama with Blender. */
export async function cameraPlate(pano: string, s: Pick<Shot, "camera" | "lens">, index: number, planLens?: string): Promise<string> {
  if (!await blenderAvailable()) throw new Error("Blender is not installed (BLENDER_BIN).");
  return withTemp("gtm-plate-", async (dir) => {
    const ext = /^data:image\/(\w+)/.exec(pano)?.[1] ?? "jpg";
    const panoFile = await writeDataUrl(path.join(dir, `pano.${ext}`), pano);
    const out = path.join(dir, "plate.png");
    const lens = LENS_MM[s.lens && s.lens !== "auto" ? s.lens : planLens ?? "auto"] ?? 35;
    const { yaw, pitch } = plateAngle(index, s.camera);
    const script = path.join(process.cwd(), "scripts", "blender-plate.py");
    await run(toolPath.blender(), ["-b", "--factory-startup", "--python", script, "--", panoFile, out, String(lens), String(yaw), String(pitch), "576", "1024"], { timeout: 240_000, maxBuffer: 16 * 1024 * 1024 });
    return `data:image/png;base64,${(await fs.readFile(out)).toString("base64")}`;
  });
}
