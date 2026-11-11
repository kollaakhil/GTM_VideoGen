import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "./auth";

export async function currentUser(): Promise<string> {
  const s = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) throw new Error("Not signed in");
  return s.email;
}
