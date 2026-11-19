import { execFile, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { RendererUnavailable, type BlenderTemplateId, type RenderMode, type ShotRow } from "./types";

const run = promisify(execFile);

/** Spawn with process handle tracking */
function spawnTracked(
  file: string,
  args: string[],
  options: NonNullable<Parameters<typeof execFile>[2]>,
  setProcess: (p: ChildProcess) => void
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        if (error.signal === "SIGTERM" || error.signal === "SIGKILL") {
          reject(new Error("Process was killed"));
        } else {
          reject(error);
        }
      } else {
        resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
      }
    });
    setProcess(child);
  });
}
const SCRIPT = () => path.join(process.cwd(), "scripts/blender/scene.py");

/** Looks for Blender: BLENDER_BIN, the macOS app, then PATH (Homebrew). Null when missing. */
export const BLENDER_PATHS = ["/Applications/Blender.app/Contents/MacOS/Blender", "/opt/homebrew/bin/blender", "/usr/local/bin/blender", "/usr/bin/blender"];

export async function findBlender(env: Record<string, string | undefined> = process.env, paths = BLENDER_PATHS): Promise<string | null> {
  const candidates = [env.BLENDER_BIN, ...paths].filter((x): x is string => !!x);
  for (const c of candidates) {
    try {
      await fs.access(c, fs.constants.X_OK);
      return c;
    } catch { /* next */ }
  }
  return null;
}

/** Off under vitest unless BLENDER_SCENES=1, so unit tests never launch Blender; BLENDER_SCENES=0 disables it anywhere. */
export async function sceneAvailable(env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (env.BLENDER_SCENES === "0" || (env.VITEST && env.BLENDER_SCENES !== "1")) return false;
  if (!(await findBlender(env))) return false;
  try {
    await fs.access(SCRIPT());
    return true;
  } catch {
    return false;
  }
}

/** Picks the camera template from the sheet's camera column. Default is the slow push-in every example uses. */
export function inferTemplate(row: Pick<ShotRow, "camera" | "action" | "template">): BlenderTemplateId {
  if (row.template) return row.template;
  const t = `${row.camera} ${row.action}`.toLowerCase();
  if (/rack[\s-]?focus|focus pull|pull focus/.test(t)) return "rack-focus";
  if (/orbit|arc|turntable|circle|revolve/.test(t)) return "orbit";
  if (/locked[\s-]?off|static|macro|tripod|still camera/.test(t)) return "macro";
  return "push-in";
}

const COLOURS: [RegExp, string][] = [
  [/magenta|hot pink|pink|fuchsia/, "#ff2bd6"], [/cyan|teal|aqua/, "#19e6ff"], [/amber|orange/, "#ff9a1f"], [/\bred\b/, "#ff2a2a"],
  [/\bblue\b|indigo/, "#2b6cff"], [/green|lime/, "#2bff7a"], [/purple|violet/, "#9a3dff"], [/\bwarm\b|tungsten|yellow|gold/, "#ffc46b"],
];

/** Light setup and accent colour from the sheet's lighting text. */
export function lightingFrom(lighting = ""): { light: "rim" | "practical" | "both"; accent: string } {
  const l = lighting.toLowerCase();
  const practical = /practical|neon|tube|glow|lamp|bulb|sign|led/.test(l);
  const rim = /rim|edge|back-?light/.test(l);
  const accent = COLOURS.find(([re]) => re.test(l))?.[1] ?? "#ffd9a0";
  return { light: practical && !rim ? "practical" : rim && !practical ? "rim" : "both", accent };
}

export interface SceneOptions {
  mode: RenderMode;
  width: number;
  height: number;
  image?: string;
  /** Render one still at t in 0..1 instead of a clip. */
  at?: number;
  samples?: number;
  timeoutMs?: number;
}

/** Sizes: preview is EEVEE with the short side at 720px; final keeps the requested size (Cycles). */
export function sceneSize(mode: RenderMode, width: number, height: number) {
  if (mode === "final") return { width, height };
  const k = 720 / Math.min(width, height);
  const even = (n: number) => Math.round(n / 2) * 2;
  return { width: even(width * k), height: even(height * k) };
}

export function sceneArgs(row: ShotRow, o: SceneOptions, img: string | null, out: string): string[] {
  const { light, accent } = lightingFrom(row.lighting);
  const size = sceneSize(o.mode, o.width, o.height);
  const lens = Math.min(135, Math.max(24, row.lensMm ?? (inferTemplate(row) === "macro" ? 100 : 85)));
  return [
    "-b", "--factory-startup", "-P", SCRIPT(), "--", "--template", inferTemplate(row), "--mode", o.mode, "--out", out,
    "--seconds", String(Math.max(0.5, row.seconds)), "--width", String(size.width), "--height", String(size.height), "--lens", String(lens),
    "--light", light, "--accent", accent, ...(img ? ["--image", img] : []), ...(o.at !== undefined ? ["--at", String(o.at)] : []),
    ...(o.samples ? ["--samples", String(o.samples)] : []),
  ];
}

const write = async (file: string, media: string) =>
  fs.writeFile(file, media.startsWith("data:") ? Buffer.from(media.split(",")[1], "base64") : Buffer.from(await (await fetch(media)).arrayBuffer()));

/** Renders a template scene headless. Returns an MP4 data URL (a PNG data URL when `at` is set). */
export async function renderBlenderScene(row: ShotRow, o: SceneOptions, setProcess: (p: ChildProcess) => void = () => {}): Promise<string> {
  const bin = await findBlender();
  if (!bin || !(await sceneAvailable())) throw new RendererUnavailable("blender", "Blender or scripts/blender/scene.py not found");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gtm-scene-"));
  try {
    let img: string | null = null;
    if (o.image) {
      img = path.join(dir, "product.png");
      await write(img, o.image);
    }
    const frames = path.join(dir, "frames");
    const { stdout } = await spawnTracked(bin, sceneArgs(row, o, img, frames), { timeout: o.timeoutMs ?? (o.mode === "final" ? 1_800_000 : 600_000), maxBuffer: 32 * 1024 * 1024 }, setProcess);
    if (!stdout.includes("SCENE_OK")) throw new Error("Blender scene did not finish");
    if (o.at !== undefined) return `data:image/png;base64,${(await fs.readFile(path.join(frames, "still.png"))).toString("base64")}`;
    const out = path.join(dir, "scene.mp4");
    await run(ffmpegPath || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-framerate", "30", "-i", path.join(frames, "f_%04d.png"), "-c:v", "libx264", "-preset", "veryfast", "-crf", o.mode === "final" ? "16" : "20", "-pix_fmt", "yuv420p", "-y", out], { timeout: 180_000 });
    return `data:video/mp4;base64,${(await fs.readFile(out)).toString("base64")}`;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
