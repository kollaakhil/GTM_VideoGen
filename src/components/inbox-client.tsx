"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { InboxItem } from "@/lib/types";

export function InboxClient({ initial, media }: { initial: InboxItem[]; media: Record<string, string> }) {
  const [items, setItems] = useState(initial);
  const [note, setNote] = useState<string | null>(null);

  async function decide(id: string, decision: "approved" | "rejected") {
    const res = await fetch("/api/inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, decision }) });
    const json = await res.json();
    if (!res.ok) return setNote(json.error);
    setNote(json.note);
    setItems((xs) => xs.map((x) => (x.id === id ? json.item : x)));
  }

  const pending = items.filter((i) => i.status === "pending");
  const done = items.filter((i) => i.status !== "pending");

  return (
    <div className="max-w-3xl space-y-6 p-8">
      {note && <div className="rounded-md border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-sm">{note}</div>}
      <div className="space-y-3">
        {pending.length === 0 && <div className="text-sm text-muted-foreground">Nothing waiting. 🎉</div>}
        {pending.map((i) => (
          <div key={i.id} className="flex items-center gap-4 rounded-xl border bg-card p-4">
            {i.creativeId && media[i.creativeId] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={media[i.creativeId]} alt="" className="size-14 rounded-md object-cover" />
            )}
            <div className="flex-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                {i.title}
                <Badge variant="outline">{i.kind === "publish" ? "Publish" : "Budget"}</Badge>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{i.detail}</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => decide(i.id, "rejected")}><X /> Reject</Button>
            <Button size="sm" onClick={() => decide(i.id, "approved")}><Check /> Approve</Button>
          </div>
        ))}
      </div>
      {done.length > 0 && (
        <div>
          <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">History</div>
          <div className="space-y-1">
            {done.map((i) => (
              <div key={i.id} className="flex justify-between rounded-md px-3 py-2 text-sm text-muted-foreground">
                <span>{i.title}</span>
                <span className="capitalize">{i.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
