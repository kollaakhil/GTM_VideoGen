import fs from "node:fs/promises";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { hasFile, run, toolPath, withTemp, writeDataUrl } from "./local-tools";

const FFMPEG = ffmpegPath || "ffmpeg";

export type UpscaleMethod = "realesrgan" | "lanczos";

/** Real-ESRGAN model for live-action footage. realesr-animevideov3 is ~0.6s/frame at 480p on an M-series Mac; realesrgan-x4plus is sharper but several times slower. */
const model = () => process.env.REALESRGAN_MODEL || "realesr-animevideov3";

export async function upscalerAvailable() {
  const name = model();
  const param = name.includes("animevideov3") ? `${name}-x2.param` : `${name}.param`;
  return await hasFile(toolPath.realesrgan()) && await hasFile(path.join(toolPath.realesrganModels(), param));
}

/**
 * Upscales one approved 480p clip to `width` (9:16) without changing its content: same frames, same timing.
 * Real-ESRGAN (ncnn, local, free) restores detail; without it, a Lanczos resize plus light sharpening is used.
 * RIFE frame interpolation is opt-in (VIDEO_INTERPOLATE=1) because it can smear fast motion.
 */
export async function upscaleClip(clip: string, width = 1080): Promise<{ url: string; method: UpscaleMethod; interpolated: boolean }> {
  return withTemp("gtm-upscale-", async (dir) => {
    const src = await writeDataUrl(path.join(dir, "in.mp4"), clip);
    const height = Math.round((width * 16) / 9 / 2) * 2;
    const fit = `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},setsar=1`;
    const fps = await clipFps(src);
    const out = path.join(dir, "out.mp4");
    const encode = ["-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-an", "-y", out];
    let method: UpscaleMethod = "lanczos";
    let interpolated = false;
    if (await upscalerAvailable()) {
      const frames = path.join(dir, "f");
      const big = path.join(dir, "u");
      await fs.mkdir(frames);
      await fs.mkdir(big);
      await run(FFMPEG, ["-v", "error", "-i", src, "-vsync", "0", path.join(frames, "%05d.png")], { timeout: 180_000 });
      const name = model();
      const scale = name.includes("animevideov3") ? "2" : "4";
      try {
        await run(toolPath.realesrgan(), ["-i", frames, "-o", big, "-n", name, "-s", scale, "-m", toolPath.realesrganModels(), "-f", "png"], { timeout: 1_200_000, maxBuffer: 16 * 1024 * 1024 });
        let seq = big;
        let rate = fps;
        if (process.env.VIDEO_INTERPOLATE === "1" && await hasFile(toolPath.rife())) {
          const smooth = path.join(dir, "r");
          await fs.mkdir(smooth);
          try {
            await run(toolPath.rife(), ["-i", big, "-o", smooth, "-m", path.join(path.dirname(await fs.realpath(toolPath.rife())), "rife-v4.6")], { timeout: 1_200_000, maxBuffer: 16 * 1024 * 1024 });
            seq = smooth;
            rate = fps * 2;
            interpolated = true;
          } catch { /* keep the upscaled frames at the original rate */ }
        }
        await run(FFMPEG, ["-v", "error", "-framerate", String(rate), "-i", path.join(seq, "%05d.png"), "-vf", fit, ...encode], { timeout: 300_000 });
        method = "realesrgan";
      } catch {
        method = "lanczos";
      }
    }
    if (method === "lanczos") {
      await run(FFMPEG, ["-v", "error", "-i", src, "-vf", `${fit},unsharp=5:5:0.6`, ...encode], { timeout: 300_000 });
    }
    return { url: `data:video/mp4;base64,${(await fs.readFile(out)).toString("base64")}`, method, interpolated };
  });
}

async function clipFps(file: string) {
  const out = await run(FFMPEG, ["-hide_banner", "-i", file], { timeout: 30_000 }).catch((e) => e as { stderr?: string });
  const m = String(out.stderr ?? "").match(/(\d+(?:\.\d+)?) fps/);
  const fps = m ? Number(m[1]) : 24;
  return fps > 0 && fps <= 120 ? fps : 24;
}
