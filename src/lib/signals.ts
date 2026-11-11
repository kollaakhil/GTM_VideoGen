import { createHash, createHmac, timingSafeEqual } from "crypto";

export const sha256 = (v: string) => createHash("sha256").update(v.trim().toLowerCase()).digest("hex");

const STRIPE_TOLERANCE_S = 300;

export function verifyStripe(payload: string, header: string | null, secret: string, nowS = Math.floor(Date.now() / 1000)): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  if (!parts.t || !parts.v1) return false;
  if (!/^\d+$/.test(parts.t) || Math.abs(nowS - Number(parts.t)) > STRIPE_TOLERANCE_S) return false;
  const expected = createHmac("sha256", secret).update(`${parts.t}.${payload}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function sendMetaCapi(e: { eventName: string; email?: string; phone?: string; value: number; currency: string; eventId: string }) {
  const pixel = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_TOKEN;
  if (!pixel || !token) return { status: "skipped" as const, detail: "META_PIXEL_ID / META_CAPI_TOKEN not set" };
  const user_data: Record<string, string[]> = {};
  if (e.email) user_data.em = [sha256(e.email)];
  if (e.phone) user_data.ph = [sha256(e.phone.replace(/\D/g, ""))];
  const body = {
    data: [
      {
        event_name: e.eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: e.eventId,
        action_source: "website",
        user_data,
        custom_data: { value: e.value, currency: e.currency },
      },
    ],
  };
  const res = await fetch(`https://graph.facebook.com/v21.0/${pixel}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return res.ok ? { status: "sent" as const, detail: "Meta CAPI accepted" } : { status: "failed" as const, detail: (await res.text()).slice(0, 200) };
}
