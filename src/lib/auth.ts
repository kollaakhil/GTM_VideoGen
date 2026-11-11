import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "gtm_session";
const MAX_AGE = 60 * 60 * 24 * 7;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) return null;
  return new TextEncoder().encode(s);
}

export function authConfigured() {
  return !!(secret() && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD);
}

export async function createSession(email: string) {
  const key = secret();
  if (!key) throw new Error("SESSION_SECRET must be at least 32 characters");
  return new SignJWT({ email }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(key);
}

export async function verifySession(token: string | undefined): Promise<{ email: string } | null> {
  const key = secret();
  if (!token || !key) return null;
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    return typeof payload.email === "string" ? { email: payload.email } : null;
  } catch {
    return null;
  }
}

export function safeEqual(a: string, b: string) {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
  path: "/",
  maxAge: MAX_AGE,
};
