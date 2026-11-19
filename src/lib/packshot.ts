import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import type { Shot } from "./types";

const run = promisify(execFile);

/**
 * Blender packshot: the real product photo's label, unwrapped onto a simple can model under studio light
 * (scripts/blender/packshot.py, Blender 5.x EEVEE, local and free). Used as the end/hero shot, so the last thing the
 * viewer sees is the exact label, never a re-drawn one. Blender is GPL; the renders are ours.
 */
export const PACKSHOT_MODEL = "blender:packshot";
export const blenderBin = () => process.env.BLENDER_BIN || "/Applications/Blender.app/Contents/MacOS/Blender";
const SCRIPT = () => path.join(process.cwd(), "scripts/blender/packshot.py");

export async function packshotAvailable() {
  // Off under vitest unless PACKSHOT=1, so unit tests never launch Blender.
  if (process.env.PACKSHOT === "0" || (process.env.VITEST && process.env.PACKSHOT !== "1")) return false;
  try {
    await Promise.all([fs.access(blenderBin()), fs.access(SCRIPT())]);
    return true;
  } catch {
    return false;
  }
}

const write = async (file: string, media: string) =>
  fs.writeFile(file, media.startsWith("data:") ? Buffer.from(media.split(",")[1], "base64") : Buffer.from(await (await fetch(media)).arrayBuffer()));

/** Renders a still (PNG data URL) or a clip (MP4 data URL) of the product. */
export async function renderPackshot(productImage: string, o: { seconds?: number; width: number; height: number; bg?: string; still?: boolean }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gtm-pack-"));
  try {
    const img = path.join(dir, "product.png");
    await write(img, productImage);
    const frames = path.join(dir, "frames");
    const args = ["-b", "--factory-startup", "-P", SCRIPT(), "--", "--image", img, "--out", frames, "--width", String(o.width), "--height", String(o.height), "--seconds", String(o.seconds ?? 3), "--bg", o.bg ?? "#1b1b1b", ...(o.still ? ["--still"] : [])];
    const { stdout } = await run(blenderBin(), args, { timeout: 600_000, maxBuffer: 32 * 1024 * 1024 });
    if (!stdout.includes("PACKSHOT_OK")) throw new Error("Blender packshot did not finish");
    if (o.still) return `data:image/png;base64,${(await fs.readFile(path.join(frames, "still.png"))).toString("base64")}`;
    const out = path.join(dir, "packshot.mp4");
    await run(ffmpegPath || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-framerate", "30", "-i", path.join(frames, "f_%04d.png"), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-y", out], { timeout: 120_000 });
    return `data:video/mp4;base64,${(await fs.readFile(out)).toString("base64")}`;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** The plan's last shot as a studio packshot: same beat, VO and overlay; the picture is the real product. */
export function packshotShot(s: Shot, product: string): Shot {
  const visual = `Studio packshot: the real ${product} can stands on a glossy floor and turns slowly under soft studio light, its label facing camera.`;
  return {
    ...s, source: "packshot", visual, expectedVisual: visual, camera: "slow 28° orbit with a 6% push-in", model: PACKSHOT_MODEL,
    spec: {
      subject: `the real ${product} can, alone`, productFraming: "can fills about 72% of the frame height, label square to camera", lensMm: 85,
      cameraMove: "slow 28° orbit with a 6% push-in", lighting: "large softbox key from front-left, cool rim light from back-right, soft fill",
      setting: "seamless dark studio floor", motionBeats: [`0–${s.seconds}s the camera orbits slowly; the can stays still and sharp`], negative: [],
    },
  };
}
