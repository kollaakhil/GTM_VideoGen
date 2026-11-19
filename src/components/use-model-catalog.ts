"use client";

import { useEffect, useState } from "react";
import type { ClientModel } from "@/lib/registry/client";
import type { Stage } from "@/lib/registry/types";

export interface ModelCatalog {
  stages: { id: Stage; label: string; hint: string }[];
  defaults: Record<Stage, string>;
  models: ClientModel[];
}

let cached: Promise<ModelCatalog> | null = null;

/** Loads the model registry once per page load from /api/models. */
export function useModelCatalog(): { catalog: ModelCatalog | null; error: string | null } {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    cached ??= fetch("/api/models").then((r) => (r.ok ? (r.json() as Promise<ModelCatalog>) : Promise.reject(new Error(`Model list failed (${r.status})`))));
    let live = true;
    cached.then((c) => live && setCatalog(c), (e: Error) => { cached = null; if (live) setError(e.message); });
    return () => { live = false; };
  }, []);
  return { catalog, error };
}

/** The picks a run starts with: every stage on its default, video on Auto. */
export function initialPicks(c: ModelCatalog | null): Partial<Record<Stage, string>> {
  if (!c) return {};
  return { ...c.defaults, video: "auto" };
}
