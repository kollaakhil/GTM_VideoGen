import { lookup } from "node:dns/promises";
import net from "node:net";

const MAX_BYTES = 2_000_000;
const MAX_REDIRECTS = 3;

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateIp(v6.slice(7));
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb") || v6.startsWith("ff");
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http(s) URLs are allowed");
  if (url.username || url.password) throw new Error("URLs with credentials are not allowed");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("Non-standard ports are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) throw new Error("Private hosts are not allowed");
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error("URL resolves to a private address");
  return url;
}

/** Fetches a public web page with SSRF protection, manual redirect validation, a timeout and a size cap. */
export async function safeFetchText(raw: string): Promise<string> {
  let target = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicUrl(target);
    const res = await fetch(url, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 GTM-Engine" }, signal: AbortSignal.timeout(10_000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      target = new URL(res.headers.get("location")!, url).toString();
      continue;
    }
    if (!res.ok || !res.body) throw new Error(`Site returned ${res.status}`);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  throw new Error("Too many redirects");
}
