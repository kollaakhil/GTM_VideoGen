import type { CreativeProgress } from "@/lib/types";

export { DEFAULT_VIDEO_PLAN as DEFAULT_PLAN } from "@/lib/video-categories";

export const VOICE_OPTIONS = ["Rachel", "Aria", "Sarah", "Charlotte", "Jessica", "Lily", "Roger", "George", "Liam", "Will", "Eric", "Brian", "Daniel"];

export const SB_SHIFT = 430;

export const SPINE = { brand: 0, research: 440, brief: 900 };

export const DIR_Y = 780;

export const CR_Y = 1150;

export const PUB_Y = 1980;

export const DIR_X = [560, 930, 1300];

export const WORKING: CreativeProgress[] = ["queued", "rendering", "qa", "fixing"];

export const PROGRESS_LABEL: Record<CreativeProgress, string> = {
  queued: "Queued",
  rendering: "Rendering",
  qa: "Vision QA",
  fixing: "Auto-fixing from QA notes",
  done: "Done",
  failed: "Failed",
};

export const WRITERS: Record<string, string> = { "google/gemini-4-carbon": "Carbon", "anthropic/claude-opus-5.5": "Opus 5.5", "openai/gpt-6.1-sol": "Sol", "openai/gpt-6-astra": "Astra" };

export const JUDGES: Record<string, string> = { "openai/gpt-6.1-sol": "Sol", "anthropic/claude-sonnet-5.5": "Sonnet 5.5" };

export const hookLabels = { goal: "Goal first", friction: "Buyer friction", proof: "Tease the proof" };
