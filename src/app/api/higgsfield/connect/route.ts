import { NextResponse, type NextRequest } from "next/server";
import { appOrigin, higgsfieldAuthorizeUrl, PKCE_COOKIE } from "@/lib/higgsfield-mcp";

/** Starts "Sign in with Higgsfield" so video renders spend the account's subscription credits via Higgsfield MCP. */
export async function GET(req: NextRequest) {
  const redirectUri = `${appOrigin(req)}/api/higgsfield/callback`;
  try {
    const { url, verifier, state } = await higgsfieldAuthorizeUrl(redirectUri);
    const res = NextResponse.redirect(url);
    res.cookies.set(PKCE_COOKIE, JSON.stringify({ verifier, state, redirectUri }), { httpOnly: true, secure: redirectUri.startsWith("https"), sameSite: "lax", path: "/api/higgsfield", maxAge: 600 });
    return res;
  } catch (e) {
    return NextResponse.redirect(`${appOrigin(req)}/connections?higgsfield=${encodeURIComponent((e as Error).message)}`);
  }
}
