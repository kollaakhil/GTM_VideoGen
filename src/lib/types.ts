export type Channel = "meta" | "google";
export type CreativeStatus = "draft" | "approved" | "live" | "paused" | "rejected";

export interface Brand {
  id: string;
  name: string;
  url: string;
  voice: string;
  audience: string;
  colors: string[];
  offer?: string;
  photos?: string[];
  createdAt: string;
}

export interface Research {
  brand?: string;
  summary: string;
  audience: string;
  valueProps: string[];
  tone: string;
  angles: string[];
  sources: string[];
  styleRef?: string | null;
  colors?: string[];
}

export interface StyleDNA {
  referenceUrl: string;
  brand: string;
  tone: string;
  humor: string;
  visualLanguage: string;
  pacing: string;
  hookPatterns: string[];
  copyRules: string[];
  doNotCopy: string[];
  styleRef: string | null;
  colors: string[];
}

export interface OrganicPack {
  instagram: { caption: string; hashtags: string[] };
  tiktok: { hook: string; script: string; onScreenText: string[] };
  linkedin: string;
  xThread: string[];
  carousel: { title: string; body: string }[];
}

export interface Brief {
  objective: string;
  audience: string;
  insight: string;
  offer: string;
  mandatories: string[];
  kpi: string;
}

export interface AdCopy {
  metaPrimaryText: string;
  metaHeadline: string;
  metaCta: string;
  googleHeadlines: string[];
  googleDescriptions: string[];
}

export type VideoCategory =
  | "product_demo"
  | "ugc_testimonial"
  | "cinematic_lifestyle"
  | "motion_graphics"
  | "unboxing"
  | "before_after"
  | "problem_solution"
  | "founder_story";

export interface VideoPlan {
  category: VideoCategory;
  lengthSec: number;
  draftModel: string;
  finalModel: string;
  voice: string;
  music: boolean;
  budgetUsd: number;
}

export interface PromptEntry {
  id: string;
  category: VideoCategory;
  kind: "keyframe" | "clip";
  model: string;
  beat: string;
  visual: string;
  camera: string;
  score: number;
  brandUrl: string;
  createdAt: string;
}

export interface ShotQA {
  score: number;
  notes: string[];
}

export interface Shot {
  id: string;
  beat: string;
  seconds: number;
  visual: string;
  camera: string;
  vo: string;
  keyframe?: string | null;
  keyframeQa?: ShotQA | null;
  clip?: string | null;
  clipQa?: ShotQA | null;
  attempts?: number;
  status: "planned" | "keyframe" | "rendering" | "done" | "failed";
}

export interface Direction {
  id: string;
  title: string;
  hook: string;
  angle: string;
  format: "static" | "video";
  script: string;
  visualPrompt: string;
  copy?: AdCopy;
  shots?: Shot[];
}

export interface QAResult {
  score: number;
  pass: boolean;
  notes: string[];
}

export interface Metrics {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
}

export interface Creative {
  id: string;
  runId: string;
  title: string;
  hook: string;
  angle: string;
  format: "static" | "video";
  mediaUrl: string;
  mediaType: "image" | "video";
  model: string;
  qa: QAResult | null;
  diversity: number | null;
  status: CreativeStatus;
  channel: Channel | null;
  metrics: Metrics | null;
  costUsd: number;
  createdAt: string;
  directionId?: string;
  copy?: AdCopy | null;
  variants?: { aspect: string; url: string }[];
  qaOverride?: { by: string; at: string } | null;
}

export type Stage = "research" | "brief" | "directions" | "generate" | "qa" | "publish";

export interface RunEvent {
  at: string;
  role: "user" | "agent" | "error";
  text: string;
}

export type CreativeProgress = "queued" | "rendering" | "qa" | "fixing" | "done" | "failed";

export interface StudioRun {
  id: string;
  brandUrl: string;
  goal: string;
  format: "static" | "video";
  models: Record<"text" | "vision" | "image" | "video", string>;
  stage: Stage;
  status: "idle" | "working" | "error";
  activity: string | null;
  jobId?: string | null;
  videoPlan?: VideoPlan | null;
  events: RunEvent[];
  progress: Record<string, CreativeProgress>;
  createdBy: string;
  updatedAt: string;
  research: Research | null;
  referenceUrl?: string | null;
  offer?: string | null;
  styleDNA?: StyleDNA | null;
  organic?: OrganicPack | null;
  brief: Brief | null;
  directions: Direction[];
  creativeIds: string[];
  costUsd: number;
  createdAt: string;
}

export interface InboxItem {
  id: string;
  kind: "publish" | "budget";
  title: string;
  detail: string;
  channel: Channel;
  creativeId: string | null;
  dailyBudget: number | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}

export interface Campaign {
  id: string;
  channel: Channel;
  name: string;
  status: "active" | "paused" | "draft";
  dailyBudget: number;
  metrics: Metrics;
}

export interface MetricDay {
  date: string;
  channel: Channel;
  spend: number;
  revenue: number;
  conversions: number;
}

export interface SignalEvent {
  id: string;
  destination: "meta_capi" | "google_offline";
  eventName: string;
  value: number;
  status: "sent" | "skipped" | "failed";
  detail: string;
  createdAt: string;
}
