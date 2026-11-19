type Channel = "meta" | "google";
type CreativeStatus = "draft" | "approved" | "live" | "paused" | "rejected";

export interface Brand {
  id: string;
  name: string;
  url: string;
  voice: string;
  audience: string;
  colors: string[];
  offer?: string;
  photos?: string[];
  logo?: string | null;
  font?: { family: string; file: string } | null;
  colorRoles?: { primary?: string; accent?: string; background?: string; text?: string } | null;
  toneExamples?: string[];
  dos?: string[];
  donts?: string[];
  winners?: { image?: string | null; note: string }[];
  mustSay?: string[];
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
  /** Real competitors in the category, named by the research model and checked by the research gate. */
  competitors?: { name: string; url?: string; difference?: string }[];
  /** How a voice should say the brand, respelled for TTS ("Ollie-pop" for OLIPOP); absent when obvious. */
  pronunciation?: string;
}

export interface VoiceOfCustomer {
  phrases: string[];
  quotes?: string[];
  pains: string[];
  desires: string[];
  objections: string[];
  sources: string[];
  sourcedQuotes?: { text: string; url: string }[];
}

/** OAuth connection to a third-party account; tokens are AES-GCM sealed. */
export interface Integration {
  id: string;
  createdAt: string;
  clients: Record<string, string>;
  clientId?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  email?: string;
  connectedAt?: string;
}

export interface Swipe {
  id: string;
  brandUrl: string | null;
  url: string | null;
  image: string | null;
  note: string;
  structure: { hook: string; beats: string[]; format: string; whyItWorks: string } | null;
  /** Measured structure of an inspiration video (cuts, pacing, framing); see inspiration.ts. */
  breakdown?: InspirationBreakdown | null;
  createdBy: string;
  createdAt: string;
}

/** Structure measured from one inspiration ad. Never holds its spoken or printed lines. */
export interface InspirationBreakdown {
  id: string;
  source: string;
  kind: "video" | "image" | "page";
  duration: number;
  shotCount: number;
  avgShotSec: number;
  cutsPerSec: number;
  firstCutSec: number | null;
  firstWordSec: number | null;
  wordsPerSec: number | null;
  via: { cuts: "scenedetect" | "ffmpeg" | "none"; transcript: "whisperx" | "whisper.cpp" | "none"; ocr: "tesseract" | "none"; vision: "vlm" | "none" };
  thumb: string | null;
  textOnScreen: { at: number; words: number; zone: "top" | "middle" | "bottom" | null }[];
  shots: { start: number; end: number; framing: string; lens: string; motion: string; purpose: string; textStyle: string }[];
  format: string;
  hook: string;
  pacing: string;
  textStyle: string;
  whyItWorks: string;
  beats: string[];
  costUsd: number;
  note?: string | null;
}

export interface Concept {
  id: string;
  persona: string;
  awareness: "unaware" | "problem" | "solution" | "product" | "most";
  angle: string;
  format: string;
  hook: string;
  visualWorld: string;
  talent: string;
  setting: string;
  why: string;
  diversity?: number;
  selected?: boolean;
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

interface AdCopy {
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
  /** Default lens for every shot (see video-looks.ts); a shot can override it. */
  lens?: string;
  /** Grade and lighting recipe for keyframes and clips. */
  visualStyle?: string;
  /** Music bed style when music is on. */
  musicStyle?: string;
  /** "off" = voiceover only (end card keeps the offer); "keywords" (default) = 2-4 word captions; "full" = whole lines. */
  captions?: "off" | "keywords" | "full";
  /** How many 480p takes one click renders (1-3). */
  takes?: number;
  /** 480p candidates per shot (best-of-N, 1-4, default 3); vision QA keeps the best and only it is upscaled. */
  candidates?: number;
  /** Replace the last shot with a Blender studio packshot of the real label (new plans: on when Blender is installed). */
  packshot?: boolean;
  /** Snap cuts to music beats (default on). */
  beatSync?: boolean;
  /** Locally synthesised foley (pop, pour, fizz, clink, whoosh) by shot content (default on). */
  sfx?: boolean;
  /** Build one consistent 3D set (World Labs) and shoot every keyframe in it. */
  realSet?: boolean;
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

export type FrameCheck = "action" | "product" | "label" | "hands" | "artifacts" | "framing";
export type Severity = "ok" | "minor" | "major" | "na";

export interface ShotQA {
  /** Computed from the per-frame checklist (see `checklistScore`), not the judge's own number. */
  score: number;
  notes: string[];
  match?: "pass" | "fail" | "review";
  frames?: { at: number; match: "pass" | "fail" | "review"; note: string; repair?: "source" | "layout"; checks?: Partial<Record<FrameCheck, Severity>> }[];
  /** The judge's own 1–10 number, kept for the record only (flash judges park good work at 7). */
  judgeScore?: number;
  /** Worst severity per checklist item across frames. */
  rubric?: Partial<Record<FrameCheck, Severity>>;
}

export interface QualityFinding {
  kind: "visual" | "speech" | "copy" | "technical" | "coverage" | "preflight";
  at: number;
  aspect?: string;
  shotId?: string;
  expected: string;
  observed: string;
  status: "fail" | "review";
}

export interface VideoQuality {
  tier: "draft" | "final";
  storyboardKey?: string;
  status: "pass" | "fail" | "review";
  score: number;
  findings: QualityFinding[];
  shots: { id: string; start: number; end: number; visual: string; vo: string; onScreen: string; keyframe?: string | null; qa?: ShotQA | null }[];
  aspects: string[];
  /** Final-QA rubric breakdown (stage-gates finalChecks) and its weighted score. */
  rubric?: { name: string; score: number; note: string; by: string; weight?: number }[];
  rubricScore?: number;
}

/** Structured shot instructions (see shot-spec.ts). */
export interface ShotSpec {
  subject: string;
  productFraming: string;
  lensMm: number;
  cameraMove: string;
  lighting: string;
  setting: string;
  /** 1–3 timed beats, e.g. "0–1s can tilts", "1–3s cola streams over ice". */
  motionBeats: string[];
  /** Shot-specific things to avoid, on top of DEFAULT_NEGATIVE. */
  negative: string[];
  /** Cross-shot locks set in code (glass size/shape, label orientation), see enforceShotRules. */
  continuity?: string[];
}

export interface Shot {
  spec?: ShotSpec;
  /** "packshot": rendered locally in Blender from the real label instead of a video model (packshot.ts). */
  source?: "packshot";
  id: string;
  beat: string;
  seconds: number;
  visual: string;
  camera: string;
  vo: string;
  onScreen?: string;
  expectedVisual?: string;
  keyframe?: string | null;
  keyframeQa?: ShotQA | null;
  clip?: string | null;
  clipQa?: ShotQA | null;
  clipKey?: string;
  clipModel?: string;
  /** Operator's per-shot video model; falls back to the plan's draft model. */
  model?: string;
  /** Operator's per-shot lens; falls back to the plan lens. */
  lens?: string;
  voiceTrack?: { key: string; url: string; tempo?: number };
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
  scripts?: AdScript[];
  hookLab?: { id: string; brief: ScriptProofBrief; hooks: ScriptHook[]; writer: string; lengthSec: number; selectedId?: string };
  approvedScript?: AdScript | null;
  passingDraft?: string | null;
  storyboardKey?: string | null;
  productRefs?: string[];
  musicTrack?: { key: string; url: string };
  compactCopy?: boolean;
  /** Every 480p preview take rendered for this storyboard, newest last. */
  takes?: VideoTake[];
  /** The take a human approved for upscaling (the only take that can become HD). */
  approvedTakeId?: string | null;
  /** The World Labs set every keyframe was shot in, when the real-set toggle is on. */
  realSet?: RealSet | null;
}

/** One assembled 480p preview: the exact clips, narration and music it was cut from. */
export interface VideoTake {
  id: string;
  storyboardKey: string;
  creativeId: string;
  url: string;
  score: number;
  pass: boolean;
  clips: { shotId: string; url: string; model: string }[];
  voices: { url: string; start: number; tempo?: number }[];
  music: string | null;
  costUsd: number;
  createdAt: string;
  approvedBy?: string | null;
  upscaledCreativeId?: string | null;
  /** The final (upscaled) video and its QA score. */
  upscaledUrl?: string | null;
  finalScore?: number | null;
  /** Video, sound and edit gate scores for this take. */
  stages?: StageScore[];
}

interface RealSet {
  key: string;
  provider: "worldlabs";
  worldId: string;
  pano: string;
  plates: Record<string, string>;
  costUsd: number;
}

export interface ScriptProofBrief {
  tension: string;
  claim: string;
  action: string;
  asset?: string;
  offer: string;
  cta: string;
  quote?: { text: string; url: string };
}

export interface ScriptHook {
  id: string;
  type: "goal" | "friction" | "proof";
  visual: string;
  spoken: string;
  onScreen: string;
  review?: { score: number; note: string; blockers: string[] };
}

export interface ScriptBeat {
  seconds: number;
  visual: string;
  vo: string;
  onScreen: string;
}

export interface ScriptScore {
  overall: number;
  scores: Record<string, number>;
  notes: string[];
  unsupported: string[];
  proofProblems?: string[];
  panel: { stopRate: number; quotes: string[] };
  blockerBeat?: number;
}

export interface AdScript {
  id: string;
  framework: string;
  hook: { visual: string; spoken: string; onScreen: string };
  beats: ScriptBeat[];
  cta: string;
  score?: ScriptScore;
  checks?: string[];
  rounds?: number;
  /** What the one automatic repair round did (shown in the script gate). */
  repair?: { fixes: string[]; kept: boolean; reason: string; before?: number; after?: number };
  review?: { rubric: string; writer: string; judge: string; targetSeconds: number };
  proofBrief?: ScriptProofBrief;
  /** Script style id chosen at the Script checkpoint (absent = auto). */
  style?: string;
  /** Jev pre-check (JEV_GATES=1): per-question probabilities, why it escalated, and whether the judge was skipped. */
  gate?: { model: string; cost: number; skippedJudge: boolean; reasons: string[]; answers: { id: string; yes: number; confidence: number; ok: boolean }[] };
  /** Claims preflight on every script line: unsupported, comparison or superlative claims and where they appear. */
  claimFlags?: { where: string; claim: string }[];
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

export interface GateResult {
  pass: boolean;
  reasons: string[];
  qa: number;
  diversity: number | null;
  unsupported: string[];
  missing: string[];
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
  quality?: VideoQuality | null;
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
  feedback?: { decision: "approve" | "reject"; reason?: string; by: string; at: string } | null;
  gate?: GateResult | null;
  conceptId?: string | null;
  external?: { meta?: { campaignId: string; adsetId: string; creativeId: string; adId: string } } | null;
  publishError?: string | null;
  metricsSyncedAt?: string | null;
}

type Stage = "research" | "brief" | "directions" | "generate" | "qa" | "publish";

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
  job?: JobProgress | null;
  /** The last failed background job: the real error, and the request to send again for Retry. */
  failure?: { message: string; directionId?: string; retry?: Record<string, unknown>; at: string } | null;
  videoPlan?: VideoPlan | null;
  storyboardPhotos?: string[];
  brandId?: string | null;
  events: RunEvent[];
  progress: Record<string, CreativeProgress>;
  createdBy: string;
  updatedAt: string;
  research: Research | null;
  voc?: VoiceOfCustomer | null;
  concepts?: Concept[];
  swipeIds?: string[];
  referenceUrl?: string | null;
  /** Inspirations from the start screen, broken down into structure (swipe ids hold the same breakdowns). */
  inspirations?: InspirationBreakdown[];
  /** Write the brief right after research so the operator approves both on one screen. */
  autoBrief?: boolean;
  /** Script style the operator picked at the Script checkpoint (see script-styles.ts). */
  scriptStyle?: string | null;
  offer?: string | null;
  styleDNA?: StyleDNA | null;
  organic?: OrganicPack | null;
  brief: Brief | null;
  directions: Direction[];
  creativeIds: string[];
  /** Per-stage quality gate scores keyed by stage or stage:directionId (see stage-gates.ts). */
  stageScores?: Record<string, StageScore>;
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

export type StageId = "research" | "brief" | "script" | "shots" | "voice" | "video" | "audio" | "edit" | "final";

export interface StageScore {
  stage: StageId;
  /** Calibrated score the gate compares against its threshold. */
  score: number;
  /** Score before judge calibration. */
  raw: number;
  pass: boolean;
  checks: { name: string; score: number; note: string; by: "rules" | "judge"; weight?: number }[];
  notes: string[];
  attempts: number;
  judge: string;
  override: { by: string; at: string; reason: string } | null;
  at: string;
}

/** Judge calibration against the labeled golden set; disagreements are kept for review. */
export interface JudgeCalibration {
  id: string;
  createdAt: string;
  judges: { judge: string; kind: string; accuracy: number; inflation: number; items: number }[];
  disagreements: { kind: string; item: string; label: "pass" | "fail"; expected: number; got: number; note: string }[];
  costUsd: number;
}

export type JobPhase = "queued" | "preflight" | "voice" | "rendering" | "qa" | "stitching" | "upscaling" | "done" | "failed";

/** Background job progress the UI polls: overall step, phase, and one entry per shot for video renders. */
export interface JobProgress {
  label: string;
  done: number;
  total: number;
  directionId?: string;
  phase?: JobPhase;
  startedAt?: string;
  shots?: { id: string; stage: JobPhase; startedAt?: string; endedAt?: string }[];
}
