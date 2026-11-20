import { execFile, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { dur, type SheetShot, type ShotSheet } from "@/lib/shot-sheet";
import { findBlender } from "./blender-scene";
import { RendererUnavailable, type RenderMode } from "./types";
import { kitFallback } from "@/lib/sheet/version-estimate";
export { kitFallback };

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
const FPS = 24;

/**
 * The shot sheet's own Blender templates (glow_word, macro_label, product_hero, glb_turntable in shot_kit.py; lab in
 * scene_kit.py). These need no product photo, so a software launch (no packshot) still gets free, real 3D heroes.
 */
export interface KitJob { script: "shot_kit.py" | "scene_kit.py"; spec: Record<string, unknown> }

const ACCENT = /#[0-9a-fA-F]{6}/;

/** Normalizes camera move string (passes unknown moves through). */
const moveOf = (m: string) => m.toLowerCase();
const amountOf = (m: string) => Math.min(0.35, Math.max(0.06, Number(m.match(/(\d+)\s*%/)?.[1] ?? 12) / 100));
const angleOf = (a: string) => (/low/i.test(a) ? "low" : /high/i.test(a) ? "high" : /top|overhead/i.test(a) ? "top" : "eye");

/** Resolves font name to portable bundled font path. Falls back to macOS system fonts when name is not recognized. */
function resolveFontPath(name: string): string {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const bundled = path.join(process.cwd(), "assets", "fonts");
  
  // Common bundled fonts
  if (/^dejavu|sans/.test(normalized)) return path.join(bundled, "DejaVuSans-Bold.ttf");
  if (/^arial/.test(normalized)) return path.join(bundled, "Arial.ttf");
  if (/^courier/.test(normalized)) return path.join(bundled, "CourierNew.ttf");
  if (/^helvetica/.test(normalized)) return path.join(bundled, "Helvetica.ttf");
  
  // If it looks like an absolute path, use it
  if (path.isAbsolute(name)) return name;
  
  // macOS fallback for legacy compatibility
  if (process.platform === "darwin") {
    if (/arial.*round/i.test(name)) return "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf";
    if (/courier/i.test(name)) return "/System/Library/Fonts/Supplemental/Courier New Bold.ttf";
    if (/helvetica/i.test(name)) return "/System/Library/Fonts/Helvetica.ttc";
  }
  
  // Default to bundled sans
  return path.join(bundled, "DejaVuSans-Bold.ttf");
}

/** One sheet row to a kit job. Size is the render size; preview renders EEVEE at fewer samples. */
export function kitJob(s: SheetShot, sheet: Pick<ShotSheet, "palette" | "look">, o: { width: number; height: number; mode: RenderMode; blender?: SheetShot["blender"] }): KitJob {
  const b = o.blender ?? s.blender ?? kitFallback(s);
  const seconds = Math.max(0.5, dur(s));
  
  // Look: per-shot override, then sheet, then brand palette, then no fallback
  const look = s.look ?? sheet.look;
  const brandAccent = sheet.palette.match(ACCENT)?.[0];
  const color = b.color ?? look?.palette?.[0] ?? brandAccent;
  
  // Measured on the 8 GB M-series Mac (EEVEE, GPU bound): the lab scene takes ~95 s per clip second at 720p/16 samples.
  // So previews render at 360p (for picking a version) and finals at 720p; the edit scales them to the delivery size.
  const k = (o.mode === "final" ? 720 : 360) / Math.min(o.width, o.height);
  const even = (n: number) => Math.max(2, Math.round((n * Math.min(1, k)) / 2) * 2);
  const samples = o.mode === "final" ? 16 : 8;
  const base = { mode: o.mode, seconds, fps: FPS, width: even(o.width), height: even(o.height), samples };
  // Font resolver: bundled fonts or user-provided path
  const fontPath = look?.font ? resolveFontPath(look.font) : undefined;
  
  if (b.template === "lab") {
    const t = `${s.subject} ${s.action}`.toLowerCase();
    const preset = /toggle|switch|relay|contact/.test(t) ? "macro_contact" : /tube|gas|trace|electrode|discharge/.test(t) && /macro|ecu|cu/i.test(`${s.shotType} ${s.framing}`) ? "macro_trace" : b.label && /macro|ecu/i.test(`${s.shotType} ${s.framing}`) ? "macro_text" : "wide";
    const ignite = b.ignite ?? (/ignit|strike|flash/.test(t) ? Math.min(seconds * 0.4, 1.2) : -1);
    return {
      script: "scene_kit.py",
      spec: {
        ...base, samples: o.mode === "final" ? 24 : 8,
        camera: { preset, push: amountOf(s.camera.move), lens: s.camera.lensMm },
        labels: b.label ? [{ text: b.label.slice(0, 40), x: -0.3, z: 0.38, size: 0.06 }] : [],
        traces: [{ preset: "speed", color, ignite }, { preset: "depth", color, ignite: ignite < 0 ? -1 : ignite + 0.15, fill: 0.8 }],
        ...(/toggle|switch|relay|snap/.test(t) ? { toggle: { close: Math.min(seconds * 0.4, 0.8) } } : {}),
        ...(fontPath ? { fontPath } : {}),
        ...(look?.background ? { background: look.background } : {}),
        ...(look?.grade ? { grade: look.grade } : {}),
        ...(look?.rimColor ? { rimColor: look.rimColor } : {}),
      },
    };
  }
  return {
    script: "shot_kit.py",
    spec: {
      ...base, template: b.template, word: b.word, label: b.label, color, ignite: b.ignite ?? -1,
      camera: { move: moveOf(s.camera.move), amount: amountOf(s.camera.move), lens: s.camera.lensMm, angle: angleOf(s.camera.angle) },
      ...(fontPath ? { fontPath } : {}),
      ...(look?.background ? { background: look.background } : {}),
      ...(look?.grade ? { grade: look.grade } : {}),
      ...(look?.rimColor ? { rimColor: look.rimColor } : {}),
      ...(look?.palette?.[0] && b.template === "macro_label" ? { materialColor: look.palette[0] } : {}),
    },
  };
}

/** Renders a kit job headless and encodes the frames to an MP4 data URL. */
export async function renderKit(job: KitJob, o: { image?: string; glb?: string; timeoutMs?: number; mode: RenderMode }, setProcess: (p: ChildProcess) => void = () => {}): Promise<string> {
  const bin = await findBlender();
  if (!bin) throw new RendererUnavailable("blender", "Blender not found");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gtm-kit-"));
  try {
    const spec: Record<string, unknown> = { ...job.spec };
    if (o.image) {
      const img = path.join(dir, "product.png");
      await fs.writeFile(img, Buffer.from(o.image.split(",")[1] ?? "", "base64"));
      spec.image = img;
    }
    if (o.glb) spec.glb = o.glb;
    const specFile = path.join(dir, "spec.json");
    await fs.writeFile(specFile, JSON.stringify(spec));
    const frames = path.join(dir, "frames");
    await fs.mkdir(frames);
    const script = path.join(process.cwd(), "scripts/blender", job.script);
    await spawnTracked(bin, ["-b", "--factory-startup", "-P", script, "--", "--spec", specFile, "--out", frames], { timeout: o.timeoutMs ?? (o.mode === "final" ? 1_200_000 : 300_000), maxBuffer: 64 * 1024 * 1024 }, setProcess);
    const pngs = (await fs.readdir(frames)).filter((f) => f.endsWith(".png"));
    if (!pngs.length) throw new Error(`Blender ${job.script} rendered no frames`);
    const out = path.join(dir, "kit.mp4");
    await run(ffmpegPath || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-framerate", String(FPS), "-pattern_type", "glob", "-i", path.join(frames, "f_*.png"), "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", o.mode === "final" ? "16" : "20", "-pix_fmt", "yuv420p", "-y", out], { timeout: 180_000 });
    return `data:video/mp4;base64,${(await fs.readFile(out)).toString("base64")}`;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
