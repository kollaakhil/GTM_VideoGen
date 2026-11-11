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

export interface Direction {
  id: string;
  title: string;
  hook: string;
  angle: string;
  format: "static" | "video";
  script: string;
  visualPrompt: string;
  copy?: AdCopy;
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
  events: RunEvent[];
  progress: Record<string, CreativeProgress>;
  createdBy: string;
  updatedAt: string;
  research: Research | null;
  referenceUrl?: string | null;
  offer?: string | null;
  styleDNA?: StyleDNA | null;
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
