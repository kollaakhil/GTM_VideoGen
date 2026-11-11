import type { Metrics } from "./types";

export const usd = (n: number, digits = 0) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits, minimumFractionDigits: digits });
export const num = (n: number) => n.toLocaleString("en-US");
export function kpis(m: Metrics | null) {
  if (!m || !m.spend) return null;
  return {
    ctr: m.impressions ? (m.clicks / m.impressions) * 100 : 0,
    cpa: m.conversions ? m.spend / m.conversions : 0,
    roas: m.spend ? m.revenue / m.spend : 0,
  };
}
