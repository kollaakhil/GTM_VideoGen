import { NextResponse } from "next/server";
import { z } from "zod";
import { authConfigured, cookieOptions, createSession, safeEqual, SESSION_COOKIE } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const Body = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

export async function POST(req: Request) {
  if (!authConfigured()) return NextResponse.json({ error: "Login is not configured. Set ADMIN_EMAIL, ADMIN_PASSWORD and SESSION_SECRET." }, { status: 503 });
  if (!rateLimit(`login:${clientIp(req)}`, 5, 60_000)) return NextResponse.json({ error: "Too many attempts. Try again in a minute." }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter an email and password" }, { status: 400 });
  const { email, password } = parsed.data;
  const emailOk = safeEqual(email.toLowerCase(), process.env.ADMIN_EMAIL!.toLowerCase());
  const passOk = safeEqual(password, process.env.ADMIN_PASSWORD!);
  const ok = emailOk && passOk;
  if (!ok) return NextResponse.json({ error: "Wrong email or password" }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSession(email.toLowerCase()), cookieOptions);
  return res;
}
