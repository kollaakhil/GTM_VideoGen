"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** Signs the engine into the user's Higgsfield account via Higgsfield MCP, so renders use subscription credits. */
export function HiggsfieldAccount({ connected, email }: { connected: boolean; email?: string }) {
  const msg = useSearchParams().get("higgsfield");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const disconnect = async () => {
    setBusy(true);
    await fetch("/api/higgsfield/disconnect", { method: "POST" });
    setBusy(false);
    router.replace("/connections");
    router.refresh();
  };
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Higgsfield account (MCP)</div>
        <span className={cn("flex items-center gap-1.5 text-xs", connected ? "text-emerald-400" : "text-muted-foreground")}>
          <i className={cn("size-2 rounded-full", connected ? "bg-emerald-400" : "bg-zinc-600")} />
          {connected ? "Connected" : "Not connected"}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Video renders spend your Higgsfield subscription credits through Higgsfield&apos;s official MCP. No API balance needed.
        {connected && email ? ` Signed in as ${email}.` : ""}
      </p>
      {msg && msg !== "connected" && <p className="mt-2 text-xs text-red-400">{msg}</p>}
      <div className="mt-3">
        {connected ? (
          <button onClick={disconnect} disabled={busy} className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50">Disconnect</button>
        ) : (
          <a href="/api/higgsfield/connect" className="inline-block rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">Connect Higgsfield account</a>
        )}
      </div>
    </div>
  );
}
