import type { Campaign, Creative, InboxItem, MetricDay, SignalEvent } from "./types";
import { placeholderImage } from "./placeholder";

const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

export function seed() {
  const base = [
    { title: "Founder story", hook: "We built this because our own ads kept failing", angle: "Origin story", status: "live", channel: "meta", spend: 1240, imp: 182000, clicks: 3100, conv: 96, rev: 5900, qa: 9 },
    { title: "Before / after", hook: "From 3 hours to 3 minutes", angle: "Time saved", status: "live", channel: "meta", spend: 980, imp: 151000, clicks: 2400, conv: 61, rev: 3700, qa: 8 },
    { title: "Social proof wall", hook: "2,000 teams switched last month", angle: "Social proof", status: "paused", channel: "google", spend: 640, imp: 88000, clicks: 1300, conv: 22, rev: 1300, qa: 8 },
    { title: "Problem agitation", hook: "Your CAC is lying to you", angle: "Pain point", status: "approved", channel: null, spend: 0, imp: 0, clicks: 0, conv: 0, rev: 0, qa: 9 },
    { title: "Offer-led", hook: "Try it free for 14 days", angle: "Offer", status: "draft", channel: null, spend: 0, imp: 0, clicks: 0, conv: 0, rev: 0, qa: 7 },
  ] as const;
  const creatives: Creative[] = base.map((b, i) => ({
    id: `cr_demo${i}`,
    runId: "run_demo",
    title: b.title,
    hook: b.hook,
    angle: b.angle,
    format: "static",
    mediaUrl: placeholderImage(b.hook, i),
    mediaType: "image",
    model: "demo",
    qa: { score: b.qa, pass: b.qa >= 8, notes: b.qa >= 8 ? ["Clear hook", "On-brand palette"] : ["Headline too small on mobile"] },
    diversity: 0.7 + i * 0.05,
    status: b.status,
    channel: b.channel,
    metrics: b.spend ? { spend: b.spend, impressions: b.imp, clicks: b.clicks, conversions: b.conv, revenue: b.rev } : null,
    costUsd: 0.04,
    createdAt: day(i + 1),
  }));

  const campaigns: Campaign[] = [
    { id: "cmp_demo1", channel: "meta", name: "Prospecting – Advantage+", status: "active", dailyBudget: 150, metrics: { spend: 2220, impressions: 333000, clicks: 5500, conversions: 157, revenue: 9600 } },
    { id: "cmp_demo2", channel: "google", name: "Search – Brand", status: "active", dailyBudget: 60, metrics: { spend: 890, impressions: 41000, clicks: 2900, conversions: 88, revenue: 6100 } },
    { id: "cmp_demo3", channel: "google", name: "PMax – Core offer", status: "paused", dailyBudget: 80, metrics: { spend: 640, impressions: 88000, clicks: 1300, conversions: 22, revenue: 1300 } },
  ];

  const inbox: InboxItem[] = [
    { id: "ibx_demo1", kind: "publish", title: "Publish “Problem agitation” to Meta", detail: "Creates a PAUSED ad in Prospecting – Advantage+", channel: "meta", creativeId: "cr_demo3", dailyBudget: null, status: "pending", createdAt: day(0) },
    { id: "ibx_demo2", kind: "budget", title: "Raise Search – Brand budget $60 → $75", detail: "ROAS 6.9x over 14 days, within +25% guardrail", channel: "google", creativeId: null, dailyBudget: 75, status: "pending", createdAt: day(0) },
  ];

  const metrics: MetricDay[] = [];
  for (let i = 29; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const w = 1 + Math.sin(i / 4) * 0.2;
    metrics.push({ date, channel: "meta", spend: Math.round(110 * w), revenue: Math.round(420 * w * (1 + (29 - i) / 60)), conversions: Math.round(7 * w) });
    metrics.push({ date, channel: "google", spend: Math.round(55 * w), revenue: Math.round(260 * w), conversions: Math.round(4 * w) });
  }

  const signals: SignalEvent[] = [
    { id: "sig_demo1", destination: "meta_capi", eventName: "Purchase", value: 99, status: "skipped", detail: "Demo event – connect Meta CAPI to send", createdAt: day(0) },
  ];

  return { creatives, campaigns, inbox, metrics, signals };
}
