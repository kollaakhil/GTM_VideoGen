"use client";

import { useMemo, useState } from "react";
import { CreativeCard } from "@/components/creative-card";
import { cn } from "@/lib/utils";
import type { Creative } from "@/lib/types";

const FILTERS = ["all", "draft", "approved", "live", "paused", "rejected"] as const;

export function LibraryClient({ initial }: { initial: Creative[] }) {
  const [items, setItems] = useState(initial);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [error, setError] = useState<string | null>(null);
  const shown = useMemo(() => items.filter((c) => filter === "all" || c.status === filter), [items, filter]);

  async function act(c: Creative, action: "approve" | "reject" | "request_publish", channel?: "meta" | "google") {
    const res = await fetch("/api/creatives", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.id, action, channel }) });
    const json = await res.json();
    if (!res.ok) return setError(json.error);
    setError(null);
    setItems((xs) => xs.map((x) => (x.id === c.id ? json.creative : x)));
  }

  return (
    <div className="p-8">
      <div className="mb-5 flex gap-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn("rounded-full px-3 py-1 text-xs capitalize", filter === f ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50")}
          >
            {f} <span className="text-muted-foreground">{f === "all" ? items.length : items.filter((c) => c.status === f).length}</span>
          </button>
        ))}
      </div>
      {error && <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((c) => (
          <CreativeCard key={c.id} creative={c} onAction={(a, ch) => act(c, a, ch)} />
        ))}
      </div>
    </div>
  );
}
