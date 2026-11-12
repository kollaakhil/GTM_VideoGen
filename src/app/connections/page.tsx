import { PageHeader } from "@/components/page-header";
import { Suspense } from "react";
import { HiggsfieldAccount } from "@/components/higgsfield-account";
import { connectionStatus } from "@/lib/connections";
import { higgsfieldMcpStatus } from "@/lib/higgsfield-mcp";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const all = connectionStatus();
  const hf = await higgsfieldMcpStatus();
  const groups = [...new Set(all.map((c) => c.group))];
  return (
    <div>
      <PageHeader title="Connections" subtitle="Set these as environment variables (Vercel project settings or .env.local)">
        <div className="text-sm text-muted-foreground">{all.filter((c) => c.configured).length}/{all.length} connected</div>
      </PageHeader>
      <div className="space-y-8 p-8">
        {groups.map((g) => (
          <div key={g}>
            <div className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">{g}</div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {all.filter((c) => c.group === g).map((c) => (
                <div key={c.id} className="rounded-xl border bg-card p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">{c.name}</div>
                    <span className={cn("flex items-center gap-1.5 text-xs", c.configured ? "text-emerald-400" : c.partial ? "text-amber-400" : "text-muted-foreground")}>
                      <i className={cn("size-2 rounded-full", c.configured ? "bg-emerald-400" : c.partial ? "bg-amber-400" : "bg-zinc-600")} />
                      {c.configured ? "Connected" : c.partial ? "Partial" : "Not connected"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{c.note}</p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {c.envs.map((e) => (
                      <code key={e} className={cn("rounded px-1.5 py-0.5 text-[10px]", process.env[e] ? "bg-emerald-500/15 text-emerald-300" : "bg-muted text-muted-foreground")}>{e}</code>
                    ))}
                  </div>
                </div>
              ))}
              {g === "AI & Media" && (
                <Suspense>
                  <HiggsfieldAccount connected={hf.connected} email={hf.email} />
                </Suspense>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
