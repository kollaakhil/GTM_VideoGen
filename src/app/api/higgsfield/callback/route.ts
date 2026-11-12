import { NextResponse, type NextRequest } from "next/server";
import { appOrigin, higgsfieldExchange, PKCE_COOKIE } from "@/lib/higgsfield-mcp";

export async function GET(req: NextRequest) {
  const back = (msg: string) => {
    const res = NextResponse.redirect(`${appOrigin(req)}/connections?higgsfield=${encodeURIComponent(msg)}`);
    res.cookies.delete({ name: PKCE_COOKIE, path: "/api/higgsfield" });
    return res;
  };
  const q = req.nextUrl.searchParams;
  if (q.get("error")) return back(q.get("error_description") ?? q.get("error")!);
  let saved: { verifier: string; state: string; redirectUri: string };
  try {
    saved = JSON.parse(req.cookies.get(PKCE_COOKIE)?.value ?? "");
  } catch {
    return back("Sign-in expired, try again");
  }
  if (!q.get("code") || q.get("state") !== saved.state) return back("Sign-in failed (state mismatch), try again");
  try {
    await higgsfieldExchange(q.get("code")!, saved.verifier, saved.redirectUri);
    return back("connected");
  } catch (e) {
    return back((e as Error).message);
  }
}
