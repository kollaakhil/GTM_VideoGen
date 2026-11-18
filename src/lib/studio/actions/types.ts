import type { Parsed } from "../schema";

/** Actions that queue background work (everything except cancel, edit_brief, pick_concepts, save_storyboard_photos). */
export type PlannedBody = Exclude<Parsed, { action: "edit_brief" | "cancel" | "pick_concepts" | "save_storyboard_photos" }>;
export type ActionBody<A extends PlannedBody["action"]> = Extract<PlannedBody, { action: A }>;
/** A validated step: the activity label shown while it runs and the work to run after the response, or a 400 error. */
export type Job = { activity: string; work: () => Promise<void> } | { error: string };
