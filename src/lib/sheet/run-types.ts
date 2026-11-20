import type { Brief, Research } from "@/lib/types";
import type { ShotSheet, StyleRule } from "@/lib/shot-sheet";
import type { GateResult } from "./gate";
import type { VersionStack } from "@/lib/versions";
import type { ConceptChoice } from "./concepts";

/** Run cost so far; the render pipeline's cost meter enforces the cap on paid render calls. */
export type CostEntry = { at: string; stage: string; what: string; model: string; usd: number; estimate: number };
export type CostState = { capUsd: number; spentUsd: number; entries: CostEntry[] };

/** The five Studio steps (PLAYBOOK 14.1). Research, rules and checks fold into details panels inside them. */
export const STEPS = ["brand", "brief", "sheet", "previews", "final"] as const;
export type Step = (typeof STEPS)[number];

export type StageTiming = { stage: string; ms: number; at: string; note?: string };

export type ShotRender = {
  shotId: string;
  engine: string;
  model: string;
  url: string | null;
  cached: boolean;
  ms: number;
  usd: number;
  error?: string | null;
  fallback?: string | null;
  /** Check 2 of 3: one quick look per preview shot. */
  check?: { score: number; note: string } | null;
};

export type Version = {
  id: string;
  /** Model stack for this version: complete set of model choices. */
  stack: VersionStack;
  tier: "preview" | "final";
  status: "queued" | "rendering" | "done" | "failed" | "refused" | "cancelled";
  estimate: { usd: number; lines: { what: string; model: string; usd: number }[]; blocked: string[] } | null;
  shots: ShotRender[];
  videoUrl: string | null;
  contactUrl: string | null;
  usd: number;
  ms: number;
  error?: string | null;
  /** Mean of the per-shot preview checks (previews) or the final review median (finals). */
  score?: number | null;
};

export type FinalResult = {
  videoUrl: string;
  contactUrl: string | null;
  score: number | null;
  rubric: Record<string, number>;
  reviews: { score: number; notes: string[] }[];
  notes: string[];
  usd: number;
  ms: number;
  editorNotes: string;
  creativeId?: string | null;
};

export type GateOverride = {
  at: string;
  by: string;
  issues: Array<{ level: string; text: string; shot?: number; rule?: string }>;
};

export interface SheetRun {
  id: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  status: "idle" | "working" | "error";
  activity: string | null;
  error: string | null;
  step: Step;
  input: {
    brandUrl: string;
    brand: string;
    goal: string;
    offer: string | null;
    facts: string;
    inspirationUrl: string | null;
    photos: string[];
    targetSec: number;
    aspect: ShotSheet["aspect"];
    audioMode: ShotSheet["audioMode"];
    patternId: string;
    textModel: string;
    visionModel: string;
    reRenderAllForFinal: boolean;
  };
  research: Research | null;
  brief: Brief | null;
  concepts: ConceptChoice | null;
  rules: StyleRule[];
  ruleSource: string | null;
  script: string | null;
  sheet: ShotSheet | null;
  gate: GateResult | null;
  gateOverride: GateOverride | null;
  versions: Version[];
  picks: { mode: "video" | "shot"; video: string | null; shots: Record<string, string> };
  final: FinalResult | null;
  timings: StageTiming[];
  cost: CostState;
}
