import { NextResponse } from "next/server";
import { newId, put } from "@/lib/store";
import { sendMetaCapi, verifyStripe } from "@/lib/signals";

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "STRIPE_WEBHOOK_SECRET not set" }, { status: 503 });
  const payload = await req.text();
  if (!verifyStripe(payload, req.headers.get("stripe-signature"), secret)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }
  const event = JSON.parse(payload);
  if (event.type !== "checkout.session.completed" && event.type !== "invoice.paid") return NextResponse.json({ ignored: true });

  const obj = event.data.object;
  const email: string | undefined = obj.customer_details?.email ?? obj.customer_email;
  const value = (obj.amount_total ?? obj.amount_paid ?? 0) / 100;
  const result = await sendMetaCapi({ eventName: "Purchase", email, value, currency: (obj.currency ?? "usd").toUpperCase(), eventId: event.id });
  await put("signal_events", {
    id: newId("sig"),
    destination: "meta_capi",
    eventName: "Purchase",
    value,
    status: result.status,
    detail: result.detail,
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ ok: true });
}
