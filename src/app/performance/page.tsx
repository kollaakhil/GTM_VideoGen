import { PageHeader } from "@/components/page-header";
import { list, metrics } from "@/lib/store";
import { kpis, usd } from "@/lib/format";

export default async function PerformancePage() {
  const days = await metrics();
  const creatives = (await list("creatives")).filter((c) => c.metrics?.spend);
  const signals = await list("signal_events");

  const byDate = new Map<string, { spend: number; revenue: number; conversions: number }>();
  for (const d of days) {
    const x = byDate.get(d.date) ?? { spend: 0, revenue: 0, conversions: 0 };
    x.spend += Number(d.spend);
    x.revenue += Number(d.revenue);
    x.conversions += Number(d.conversions);
    byDate.set(d.date, x);
  }
  const series = [...byDate.entries()];
  const tot = series.reduce((a, [, x]) => ({ spend: a.spend + x.spend, revenue: a.revenue + x.revenue, conversions: a.conversions + x.conversions }), { spend: 0, revenue: 0, conversions: 0 });
  const max = Math.max(1, ...series.map(([, x]) => x.revenue));

  const angles = new Map<string, { spend: number; revenue: number }>();
  for (const c of creatives) {
    const a = angles.get(c.angle) ?? { spend: 0, revenue: 0 };
    a.spend += c.metrics!.spend;
    a.revenue += c.metrics!.revenue;
    angles.set(c.angle, a);
  }

  return (
    <div>
      <PageHeader title="Performance" subtitle="Last 30 days across Meta and Google, joined with Stripe revenue" />
      <div className="space-y-6 p-8">
        <div className="grid gap-4 md:grid-cols-4">
          <Kpi label="Spend" value={usd(tot.spend)} />
          <Kpi label="Revenue" value={usd(tot.revenue)} />
          <Kpi label="ROAS" value={`${(tot.revenue / Math.max(1, tot.spend)).toFixed(2)}x`} />
          <Kpi label="CPA" value={usd(tot.spend / Math.max(1, tot.conversions), 2)} />
        </div>

        <div className="rounded-xl border bg-card p-5">
          <div className="mb-4 flex items-center justify-between text-sm font-semibold">
            Revenue vs spend
            <div className="flex gap-3 text-xs font-normal text-muted-foreground">
              <span className="flex items-center gap-1"><i className="size-2 rounded-full bg-indigo-400" />Revenue</span>
              <span className="flex items-center gap-1"><i className="size-2 rounded-full bg-zinc-500" />Spend</span>
            </div>
          </div>
          <div className="flex h-48 items-end gap-1">
            {series.map(([date, x]) => (
              <div key={date} className="group relative flex h-full flex-1 items-end gap-px" title={`${date}: ${usd(x.revenue)} rev / ${usd(x.spend)} spend`}>
                <div className="flex-1 rounded-t bg-indigo-400/80" style={{ height: `${(x.revenue / max) * 100}%` }} />
                <div className="flex-1 rounded-t bg-zinc-500/70" style={{ height: `${(x.spend / max) * 100}%` }} />
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border bg-card p-5">
            <div className="mb-3 text-sm font-semibold">ROAS by creative angle</div>
            <div className="space-y-2">
              {[...angles.entries()]
                .map(([a, x]) => ({ a, roas: x.revenue / x.spend, spend: x.spend }))
                .sort((p, q) => q.roas - p.roas)
                .map(({ a, roas, spend }) => (
                  <div key={a} className="text-sm">
                    <div className="flex justify-between"><span>{a}</span><span className="text-muted-foreground">{roas.toFixed(1)}x · {usd(spend)}</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.min(100, roas * 15)}%` }} /></div>
                  </div>
                ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Fed back into the Studio so new briefs lean on winning angles.</p>
          </div>
          <div className="rounded-xl border bg-card p-5">
            <div className="mb-3 text-sm font-semibold">Server-side signal loop</div>
            <div className="space-y-2 text-sm">
              {signals.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2">
                  <div>
                    <div>{s.eventName} · {usd(s.value, 2)}</div>
                    <div className="text-xs text-muted-foreground">{s.destination === "meta_capi" ? "Meta CAPI" : "Google offline"} · {s.detail}</div>
                  </div>
                  <span className="text-xs capitalize text-muted-foreground">{s.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <div className="mb-3 text-sm font-semibold">Top creatives</div>
          <div className="space-y-2 text-sm">
            {creatives
              .map((c) => ({ c, k: kpis(c.metrics)! }))
              .sort((a, b) => b.k.roas - a.k.roas)
              .map(({ c, k }) => (
                <div key={c.id} className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.mediaUrl} alt="" className="size-10 rounded object-cover" />
                  <div className="flex-1"><div className="font-medium">{c.title}</div><div className="text-xs text-muted-foreground">“{c.hook}”</div></div>
                  <div className="text-right text-xs"><div>{k.roas.toFixed(1)}x ROAS</div><div className="text-muted-foreground">{usd(k.cpa, 2)} CPA</div></div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
