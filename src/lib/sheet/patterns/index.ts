/**
 * Story patterns: named narrative structures with deterministic rules the gate enforces and subjective qualities
 * the final review scores. Each pattern includes the rules verbatim, a beat map, rhythm, caption style, audio
 * and ending conventions (PLAYBOOK §14 Story Patterns).
 */

export const BEATS = [
  "goal", "personal_stake", "stake_raised", "physical_example", "but_silence",
  "owned_cause", "low_point", "crazy_plan", "cut_before_attempt", "takeaway"
] as const;

export type Beat = typeof BEATS[number];

export interface BeatSpec {
  /** The beat's role in the story. */
  beat: Beat;
  /** Expected duration range in seconds. */
  durationRange: [number, number];
  /** True when this beat should get a long take (3+ s). */
  longTake?: boolean;
  /** True when this beat should use rapid cuts (1.5–2 s). */
  quickCuts?: boolean;
  /** Camera framing: "close" for punch-in, "wide" for establish. */
  framing?: "close" | "wide";
  /** Whether a silence gap follows this beat. */
  silenceAfter?: number;
}

export interface PatternRhythm {
  /** Words per second for voiceover pacing. */
  voicePace: [number, number]; // [min, max]
  /** Beats that should slow down. */
  slowBeats: Beat[];
  /** Expected shot length during setup. */
  setupCutLength: [number, number]; // seconds
  /** Expected cutaway cadence after setup. */
  cutawayCadence: [number, number]; // seconds
}

export interface CaptionStyle {
  /** Words per caption chunk. */
  wordsPerChunk: [number, number];
  /** Whether to show a bright label in the first N seconds. */
  brightLabelBefore?: number;
}

export interface AudioStyle {
  /** Whether music is allowed. */
  music: boolean;
  /** Whether to use pauses for effect. */
  pausesWork: boolean;
}

export interface EndingStyle {
  /** Whether a call to action is allowed. */
  cta: boolean;
  /** Whether the last line should echo the first. */
  echoOpening: boolean;
}

/**
 * A named story pattern with its rules and deterministic checks.
 */
export interface StoryPattern {
  id: string;
  name: string;
  description: string;
  
  /** The 17 rules verbatim. */
  rules: string[];
  
  /** Which rules are gate-checked (deterministic) vs judged (subjective). */
  gateChecked: number[]; // indices into rules
  judged: number[]; // indices into rules
  
  /** Beat sequence and timing. */
  beats: BeatSpec[];
  
  /** Rhythm and pacing. */
  rhythm: PatternRhythm;
  
  /** Caption style. */
  captions: CaptionStyle;
  
  /** Audio conventions. */
  audio: AudioStyle;
  
  /** Ending conventions. */
  ending: EndingStyle;
}

/**
 * The "Confession loop" pattern: plain goal → personal stake → physical example → "but..." + silence →
 * owned cause → low point (viewer feeling + close-up) → crazy plan (long take) → cut before attempt →
 * takeaway that echoes opening.
 */
export const CONFESSION_LOOP: StoryPattern = {
  id: "confession_loop",
  name: "Confession loop",
  description: "Opens with the goal in plain words, ties it to something personal, shows one small physical example, brings in the problem with 'but...' and silence, gives it a specific cause the speaker owns, hits the low point with what the viewer is feeling and a close-up, follows with a crazy plan in one long take, cuts before the attempt, and ends on the takeaway that echoes the opening.",
  
  rules: [
    "Open with the goal in plain words in the very first sentence.",
    "Tie the goal to something personal, then raise that stake once.",
    "Show one small, physical example on screen instead of explaining in the abstract.",
    'Bring in the problem with "but..." and follow it with about a second of silence.',
    "Give the problem a specific cause the speaker owns.",
    'At the low point, say out loud what the viewer is feeling ("now you\'re like, uh-oh").',
    "Follow the problem with a plan that sounds a little crazy.",
    "Cut before the attempt and never show the result.",
    "Cut every 1.5-2 seconds during the setup, then hold one long take on the confession and on the plan.",
    "Cut away to a reaction or b-roll every 2-3 seconds the rest of the time.",
    "Punch in to a close-up at the low point, then go wide again after.",
    "Keep captions to 2-4 short words at a time, plus one bright label in the first 3 seconds.",
    "Speak at about 4 words per second and slow down only at the turn.",
    "Leave out music and let pauses do the work.",
    "End on the takeaway with no call to action, and echo the opening line so it loops.",
    "Promise a rule that works on anything, then prove it with one tiny example.",
    "Make the video follow the technique it teaches."
  ],
  
  gateChecked: [3, 8, 9, 10, 11, 12, 13, 14], // indices of deterministic rules
  judged: [1, 2, 4, 6, 15, 16], // indices of subjective rules
  
  beats: [
    { beat: "goal", durationRange: [1, 2], quickCuts: true },
    { beat: "personal_stake", durationRange: [1.5, 2.5], quickCuts: true },
    { beat: "stake_raised", durationRange: [1.5, 2.5], quickCuts: true },
    { beat: "physical_example", durationRange: [1.5, 2.5], quickCuts: true },
    { beat: "but_silence", durationRange: [2, 3], silenceAfter: 1 },
    { beat: "owned_cause", durationRange: [2, 3] },
    { beat: "low_point", durationRange: [3, 5], longTake: true, framing: "close" },
    { beat: "crazy_plan", durationRange: [3, 5], longTake: true },
    { beat: "cut_before_attempt", durationRange: [0.5, 1] },
    { beat: "takeaway", durationRange: [2, 3], framing: "wide" }
  ],
  
  rhythm: {
    voicePace: [3.5, 4.5], // words per second
    slowBeats: ["but_silence", "low_point"],
    setupCutLength: [1.5, 2],
    cutawayCadence: [2, 3]
  },
  
  captions: {
    wordsPerChunk: [2, 4],
    brightLabelBefore: 3
  },
  
  audio: {
    music: false,
    pausesWork: true
  },
  
  ending: {
    cta: false,
    echoOpening: true
  }
};

/**
 * The "Classic" pattern: the current default behavior with no specific story structure.
 */
export const CLASSIC: StoryPattern = {
  id: "classic",
  name: "Classic",
  description: "The current default behavior: no specific story structure, flexible pacing, music bed, standard captions.",
  
  rules: [],
  gateChecked: [],
  judged: [],
  
  beats: [],
  
  rhythm: {
    voicePace: [2, 5],
    slowBeats: [],
    setupCutLength: [1, 4],
    cutawayCadence: [1, 4]
  },
  
  captions: {
    wordsPerChunk: [1, 8]
  },
  
  audio: {
    music: true,
    pausesWork: false
  },
  
  ending: {
    cta: true,
    echoOpening: false
  }
};

export const PATTERNS: Record<string, StoryPattern> = {
  confession_loop: CONFESSION_LOOP,
  classic: CLASSIC
};

export const DEFAULT_PATTERN_ID = "confession_loop";

export function getPattern(id?: string | null): StoryPattern {
  if (!id) return PATTERNS[DEFAULT_PATTERN_ID];
  return PATTERNS[id] || PATTERNS[DEFAULT_PATTERN_ID];
}
