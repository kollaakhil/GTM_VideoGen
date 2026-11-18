import type { Modality, ModelOption } from "@/lib/models";
import type { AdScript, Brand, Creative, StudioRun, VideoPlan } from "@/lib/types";

export type Model = ModelOption & { ready: boolean };

export type { Modality };

export type RunSummary = Pick<StudioRun, "id" | "brandUrl" | "goal" | "stage" | "status" | "costUsd" | "createdAt" | "format" | "updatedAt"> & {
  thumb: { url: string; type: "image" | "video" } | null;
  creatives: number;
  passed: number;
};

export type NodeState = "done" | "active" | "working" | "error" | "idle";

export type CreativeAction = "approve" | "reject" | "request_publish" | "override_qa";

export interface Ctx {
  run: StudioRun | null;
  byDir: Record<string, Creative>;
  sending: boolean;
  models: Model[];
  form: {
    brandUrl: string;
    referenceUrl: string;
    offer: string;
    saveKit: boolean;
    kits: Brand[];
    goal: string;
    format: "static" | "video";
    sel: Record<Modality, string>;
    refs: string[];
    plan: VideoPlan;
    set: (patch: Partial<Omit<Ctx["form"], "set">>) => void;
  };
  start: () => void;
  act: (action: string, extra?: Record<string, unknown>) => Promise<boolean>;
  creativeAction: (c: Creative, a: CreativeAction, ch?: "meta" | "google", reason?: string) => void;
  editing: boolean;
  setEditing: (v: boolean) => void;
  pricing: Pricing;
}

export type Pricing = { credits: number | null; prices: Record<string, { draft: number | null; final: number | null }> };

export type BeatEdit = Pick<AdScript["beats"][number], "vo" | "onScreen">;
