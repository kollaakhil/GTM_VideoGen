import type { ShotSheet } from "@/lib/shot-sheet";
import { tc } from "./timing";

const ENGINE: Record<string, string> = { blender: "Blender 3D", ai_video: "AI video", remotion: "Remotion graphics", "3d": "3D mesh → Blender", world: "World model" };
const TRANS: Record<string, string> = { cut: "hard cut", fade_black: "fade to black", crossfade: "crossfade", whip: "whip pan" };

/** Plain-text instructions for the editor, generated from the sheet only (the same text ships next to every export). */
export function editorInstructions(sheet: ShotSheet): string {
  const head = [
    `EDIT INSTRUCTIONS — ${sheet.targetSec}s, ${sheet.aspect}, ${sheet.fps} fps, audio: ${sheet.audioMode === "foley" ? "foley-first (no VO)" : "voiceover"}`,
    `Bed: ${sheet.bed}${sheet.palette ? ` · Palette: ${sheet.palette}` : ""}`,
    `Rules: ${sheet.rules.map((r) => r.text).join(" / ") || "none"}`,
    "",
  ];
  const rows = sheet.shots.map((s) => {
    const sound = [s.audio.vo && `VO "${s.audio.vo}"`, s.audio.sfx && `SFX ${s.audio.sfx}`, s.audio.music && `Music ${s.audio.music}`].filter(Boolean).join(" · ");
    return [
      `${tc(s.start)}–${tc(s.end)}  #${s.n}  ${s.shotType}  [${ENGINE[s.engine] ?? s.engine}]`,
      `   Camera: ${s.camera.angle}, ${s.camera.move}, ${s.camera.lensMm}mm · Framing: ${s.framing}`,
      `   Subject/action: ${s.subject}${s.action ? ` — ${s.action}` : ""} · Light: ${s.lighting}`,
      `   Text: ${s.text ? `"${s.text.copy}" (${s.text.placement})` : "none"} · Sound: ${sound || "none"}`,
      `   Out: ${TRANS[s.transition] ?? s.transition}${s.editorNote ? ` · Note: ${s.editorNote}` : ""}`,
    ].join("\n");
  });
  const end = `End card: ${sheet.endCard.title}${sheet.endCard.line ? ` / ${sheet.endCard.line}` : ""}${sheet.endCard.footer ? ` / ${sheet.endCard.footer}` : ""}`;
  return [...head, ...rows, "", end].join("\n");
}
