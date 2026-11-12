import type { Brand } from "./types";

/** The brand kit as hard rules for every prompt (copy, briefs, directions, shots, QA). */
export function brandRules(b?: Brand | null) {
  if (!b) return "";
  const lines: string[] = [];
  if (b.voice) lines.push(`Voice: ${b.voice}`);
  if (b.audience) lines.push(`Audience: ${b.audience}`);
  if (b.toneExamples?.length) lines.push(`Write like these real brand lines (match rhythm and vocabulary, don't copy): ${b.toneExamples.map((t) => `"${t}"`).join(" | ")}`);
  const c = b.colorRoles;
  if (c && Object.values(c).some(Boolean)) lines.push(`Colors: ${Object.entries(c).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  if (b.dos?.length) lines.push(`Always: ${b.dos.join("; ")}`);
  if (b.donts?.length) lines.push(`Never: ${b.donts.join("; ")}`);
  if (b.mustSay?.length) lines.push(`Must say in every ad (in script, captions or copy): ${b.mustSay.join("; ")}`);
  if (b.winners?.length) lines.push(`Past winning ads and why they worked: ${b.winners.map((w) => w.note).join(" | ")}`);
  return lines.length ? `\nBrand kit rules for ${b.name} (mandatory):\n- ${lines.join("\n- ")}` : "";
}
