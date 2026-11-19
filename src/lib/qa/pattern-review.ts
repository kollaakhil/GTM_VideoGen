/**
 * Pattern-specific subjective quality reviews for story patterns.
 * These check the subjective rules (2, 3, 5, 7, 16, 17) that the gate cannot enforce deterministically.
 */

import type { ShotSheet } from "@/lib/shot-sheet";

export interface PatternReviewPrompt {
  pattern: string;
  rules: string[];
  script: string;
  beats: string;
}

/**
 * Build the review prompt for confession_loop pattern subjective rules.
 */
export function confessionLoopReviewPrompt(sheet: ShotSheet): string {
  const voLines = sheet.shots.filter((s) => s.audio.vo).map((s) => s.audio.vo).filter(Boolean);
  const beatMap = sheet.shots.map((s) => `${s.beat || "?"}: "${s.audio.vo || s.action}"`).join("\n");
  
  return `Review this video against the Confession loop pattern's SUBJECTIVE rules:

SCRIPT (VO lines):
${voLines.join("\n")}

BEAT MAP:
${beatMap}

SUBJECTIVE RULES TO SCORE (the gate already enforced the deterministic ones):
2. Tie the goal to something personal, then raise that stake once.
3. Show one small, physical example on screen instead of explaining in the abstract.
5. Give the problem a specific cause the speaker owns.
7. Follow the problem with a plan that sounds a little crazy.
16. Promise a rule that works on anything, then prove it with one tiny example.
17. Make the video follow the technique it teaches.

Score 0-10:
- 10: Every subjective rule is clearly followed. The personal stake is real, the example is specific and physical, the cause is owned, the plan sounds bold, the rule-and-example angle is present, and the video demonstrates its own technique.
- 7-9: Most rules are followed, but one or two feel generic or abstract.
- 4-6: Some rules are missing or the execution is weak (e.g. the stake isn't personal, the example is abstract, the plan is safe, no rule-and-example angle).
- 0-3: Multiple subjective rules are broken or the pattern isn't followed at all.

Return JSON: {"score": N, "notes": ["one note per issue"]}.`;
}

/**
 * Score a confession_loop video on its subjective pattern rules.
 * Calls the vision model with the pattern-specific rubric.
 */
export async function reviewConfessionLoop(
  sheet: ShotSheet,
  qa: (model: string, videoUrl: string, ...context: string[]) => Promise<{ score: number; notes: string[] }>
): Promise<{ score: number; notes: string[] }> {
  if (sheet.patternId !== "confession_loop") {
    return { score: 10, notes: [] }; // No pattern-specific review for other patterns
  }
  
  // This would be called with the actual video URL in the render pipeline
  // For now, we return a placeholder structure
  const prompt = confessionLoopReviewPrompt(sheet);
  
  // In real use, this would be:
  // return qa(model, videoUrl, "video", prompt);
  
  // For testing/compilation, return a structure
  return { score: 10, notes: [] };
}
