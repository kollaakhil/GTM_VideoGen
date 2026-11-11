import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { list } from "@/lib/store";
import { kpis, num, usd } from "@/lib/format";

export default async function CampaignsPage() {
  const campaigns = await list("campaigns");
  return (
    <div>
      <PageHeader title="Campaigns" subtitle="Meta and Google Ads campaigns synced into Supabase. Changes go through the Inbox." />
      <div className="p-8">
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                {["Campaign", "Channel", "Status", "Daily budget", "Spend", "Clicks", "Conv.", "CPA", "ROAS"].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => {
                const k = kpis(c.metrics);
                return (
                  <tr key={c.id} className="border-t">
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3">{c.channel === "meta" ? "Meta" : "Google Ads"}</td>
                    <td className="px-4 py-3">
                      <Badge variant={c.status === "active" ? "default" : "secondary"} className="capitalize">{c.status}</Badge>
                    </td>
                    <td className="px-4 py-3">{usd(c.dailyBudget)}</td>
                    <td className="px-4 py-3">{usd(c.metrics.spend)}</td>
                    <td className="px-4 py-3">{num(c.metrics.clicks)}</td>
                    <td className="px-4 py-3">{num(c.metrics.conversions)}</td>
                    <td className="px-4 py-3">{k ? usd(k.cpa, 2) : "–"}</td>
                    <td className="px-4 py-3">{k ? `${k.roas.toFixed(1)}x` : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Guardrails: new ads are created PAUSED; budget changes over ±25%/day are blocked.</p>
      </div>
    </div>
  );
}
