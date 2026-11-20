import { cached, type CacheStore, inputHash } from "../render/cache";
import { runParallel } from "../render/scheduler";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const args = { timeout: 45_000, maxBuffer: 4 * 1024 * 1024 };

/** Check (b): one cheap look per preview shot. Exactly one model call per shot, on one frame from the middle of the clip. */
export interface PreviewShot {
  id: string;
  /** What the sheet says happens (the reviewer judges this against the frame). */
  expected: string;
  /** Content or URL of the rendered clip; part of the cache key. */
  clip: string;
  /** On-screen text expected to be readable in this shot. */
  onScreen?: string;
}

export interface ShotVerdict { score: number; note: string; pass: boolean; cached: boolean }

export interface ShotCheckDeps {
  /** One frame from the clip, taken at `at` seconds. */
  frame: (clip: string, at: number) => Promise<string>;
  review: (frame: string, expected: string) => Promise<{ score: number; notes: string[] }>;
  /** Run OCR on a frame buffer (PNG). */
  ocr?: (buffer: Buffer) => Promise<{ text: string; confidence: number }>;
}

export const SHOT_PASS = 7;

/** Run Tesseract OCR on a PNG buffer, returning text and average confidence. */
export async function runTesseract(buffer: Buffer): Promise<{ text: string; confidence: number }> {
  try {
    const tsv = await new Promise<string>((resolve, reject) => {
      const p = execFile(
        process.env.TESSERACT_BIN || "tesseract",
        ["stdin", "stdout", "-l", process.env.OCR_LANG || "eng", "--psm", "6", "tsv"],
        args,
        (err, out) => (err ? reject(err) : resolve(out))
      );
      p.stdin?.on("error", () => {});
      p.stdin?.end(buffer);
    });

    const rows = tsv
      .split("\n")
      .slice(1)
      .map((l) => l.split("\t"))
      .filter((c) => c.length >= 12 && c[11]?.trim());

    if (!rows.length) return { text: "", confidence: 0 };

    const words = rows.filter((c) => /\w+/.test(c[11]));
    const confidences = words.map((c) => Number(c[10]) || 0).filter((n) => n > 0);
    const avgConfidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;
    const text = words.map((c) => c[11]).join(" ");

    return { text, confidence: avgConfidence };
  } catch {
    return { text: "", confidence: 0 };
  }
}

/**
 * Check text legibility: for shots with onScreen text, sample 2 frames and OCR them.
 * If OCR confidence < 60 or word match < 50%, the shot has unreadable text.
 */
export async function checkTextLegibility(
  shot: PreviewShot & { seconds: number },
  deps: Pick<ShotCheckDeps, "frame" | "ocr">
): Promise<{ readable: boolean; confidence: number; wordMatch: number; issue?: string } | null> {
  if (!shot.onScreen) return null;

  const ocr = deps.ocr ?? runTesseract;

  const t1 = Number((shot.seconds * 0.25).toFixed(3));
  const t2 = Number((shot.seconds * 0.75).toFixed(3));

  const [frame1Url, frame2Url] = await Promise.all([deps.frame(shot.clip, t1), deps.frame(shot.clip, t2)]);

  const frame1 = Buffer.from(frame1Url.split(",")[1], "base64");
  const frame2 = Buffer.from(frame2Url.split(",")[1], "base64");

  const [result1, result2] = await Promise.all([ocr(frame1), ocr(frame2)]);

  const avgConfidence = (result1.confidence + result2.confidence) / 2;

  const expectedWords = shot.onScreen
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  const foundWords = [result1.text, result2.text]
    .join(" ")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 2);

  const matches = expectedWords.filter((w) => foundWords.includes(w)).length;
  const wordMatch = expectedWords.length ? (matches / expectedWords.length) * 100 : 0;

  const readable = avgConfidence >= 60 && wordMatch >= 50;

  return {
    readable,
    confidence: avgConfidence,
    wordMatch,
    issue: readable ? undefined : "on-screen text unreadable",
  };
}

export async function checkPreviewShots(
  shots: (PreviewShot & { seconds: number })[],
  deps: ShotCheckDeps,
  o: { cache?: CacheStore<ShotVerdict>; model?: string; limit?: number } = {}
): Promise<Record<string, ShotVerdict>> {
  const res = await runParallel(
    shots.map((s) => ({
      id: s.id,
      stage: "shot-check",
      // Unchanged clip and expectation: no second judge call.
      key: inputHash("shot-check-v1", o.model ?? "", s.clip, s.expected, s.seconds),
      run: async (): Promise<ShotVerdict> => {
        const frame = await deps.frame(s.clip, Number((s.seconds / 2).toFixed(3)));
        const r = await deps.review(frame, s.expected);
        const score = Math.max(0, Math.min(10, r.score));
        let note = r.notes.join(" ").slice(0, 300);

        if (s.onScreen) {
          try {
            const legibility = await checkTextLegibility(s, deps);
            if (legibility && !legibility.readable) {
              note += ` ${legibility.issue} (OCR confidence ${legibility.confidence.toFixed(0)}%, word match ${legibility.wordMatch.toFixed(0)}%)`;
            }
          } catch {
            // OCR failure doesn't block the shot check
          }
        }

        return { score, note, pass: score >= SHOT_PASS, cached: false };
      },
    })),
    { limit: o.limit ?? 4, retries: 1, cache: o.cache, persist: (v) => !/could not/i.test(v.note) }
  );
  return Object.fromEntries(
    res.map((r, i) => [
      shots[i].id,
      r.status === "failed"
        ? { score: 0, note: `The check could not run: ${r.error?.message ?? "unknown error"}`, pass: false, cached: false }
        : { ...r.value!, cached: r.status === "cached" },
    ])
  );
}

export { cached };
