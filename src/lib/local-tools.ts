import { execFile } from "node:child_process";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

/** Optional local tools (all free, all optional). Each resolves from an env var, then the ~/.gtm-tools default. */
export const run = promisify(execFile);

const home = (p: string) => p.replace(/^~(?=$|\/)/, os.homedir());
const TOOLS = path.join(os.homedir(), ".gtm-tools");

export const toolPath = {
  realesrgan: () => home(process.env.REALESRGAN_BIN || path.join(TOOLS, "bin", "realesrgan-ncnn-vulkan")),
  realesrganModels: () => home(process.env.REALESRGAN_MODELS || path.join(TOOLS, "realesrgan", "models")),
  rife: () => home(process.env.RIFE_BIN || path.join(TOOLS, "bin", "rife-ncnn-vulkan")),
  python: () => home(process.env.GTM_VENV ? path.join(process.env.GTM_VENV, "bin", "python") : path.join(TOOLS, "venv", "bin", "python")),
  syncnet: () => home(process.env.SYNCNET_DIR || path.join(TOOLS, "syncnet")),
  blender: () => home(process.env.BLENDER_BIN || "/Applications/Blender.app/Contents/MacOS/Blender"),
};

export async function hasFile(p: string) {
  try {
    await fs.access(p, constants.X_OK | constants.R_OK);
    return true;
  } catch {
    try {
      await fs.access(p, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }
}

/** Python modules importable in the tools venv (cached per process). */
const modules = new Map<string, Promise<boolean>>();
export function hasPython(module: string) {
  if (!modules.has(module)) {
    modules.set(module, (async () => {
      const py = toolPath.python();
      if (!await hasFile(py)) return false;
      try {
        await run(py, ["-c", `import ${module}`], { timeout: 60_000 });
        return true;
      } catch {
        return false;
      }
    })());
  }
  return modules.get(module)!;
}

export async function withTemp<T>(prefix: string, fn: (dir: string) => Promise<T>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export async function writeDataUrl(file: string, media: string) {
  const b64 = media.startsWith("data:") ? media.slice(media.indexOf(",") + 1) : null;
  if (b64 === null) throw new Error("Expected local media bytes (a data URL).");
  await fs.writeFile(file, Buffer.from(b64, "base64"));
  return file;
}
