import type { ModelEntry } from "./types.ts";

/**
 * Pure verification logic: compares the catalog with provider model lists. `scripts/verify-models.mjs` fetches the
 * lists (all free, key-less endpoints); the tests pass fixtures. An entry whose `verify.source` is a provider list but
 * whose id is absent from that list is `missing` and fails the check. `unverified` entries are reported, never hidden.
 */
export interface OrModel { out: string[]; inUsdPerM: number; outUsdPerM: number }
export interface OrVideoModel { maxSeconds: number | null; minSeconds: number | null }
export interface ProviderLists {
  openrouter: Map<string, OrModel>;
  orVideo: Map<string, OrVideoModel>;
  /** fal endpoint id -> status ("active", "deprecated"…). */
  fal: Map<string, string>;
  hfRouter: Set<string>;
  higgsfield: Set<string>;
  /** Hugging Face repos that exist. */
  hfRepos: Set<string>;
}

export interface CheckResult {
  id: string;
  status: "verified" | "missing" | "unverified" | "local" | "uncheckable";
  warnings: string[];
  errors: string[];
}

const drift = (a: number, b: number) => (a === 0 && b === 0 ? 0 : Math.abs(a - b) / Math.max(a, b, 1e-9));

export function checkEntry(e: ModelEntry, l: ProviderLists, o: { repoCheck?: boolean } = {}): CheckResult {
  const r: CheckResult = { id: e.id, status: "verified", warnings: [], errors: [] };
  const key = e.verify.lookup ?? e.id;
  const missing = (what: string) => { r.status = "missing"; r.errors.push(what); };
  switch (e.verify.source) {
    case "unverified":
      r.status = "unverified";
      r.warnings.push(e.verify.note ?? "not checked against any provider list");
      break;
    case "local":
      r.status = "local";
      break;
    case "openrouter": {
      const m = l.openrouter.get(key);
      if (!m) { missing(`${key} is not in OpenRouter /api/v1/models`); break; }
      if (e.stages.includes("image") && !m.out.includes("image")) r.errors.push(`${key} does not output images on OpenRouter`);
      if (e.cost.unit === "per_mtok" && (drift(e.cost.usd, m.inUsdPerM) > 0.3 || drift(e.cost.usdOut ?? 0, m.outUsdPerM) > 0.3)) {
        r.warnings.push(`price drift: catalog $${e.cost.usd}/$${e.cost.usdOut} per Mtok, OpenRouter $${m.inUsdPerM}/$${m.outUsdPerM}`);
      }
      break;
    }
    case "openrouter-video": {
      const m = l.orVideo.get(key);
      if (!m) { missing(`${key} is not in OpenRouter /api/v1/videos/models`); break; }
      if (m.maxSeconds && e.caps.maxSeconds && e.caps.maxSeconds > m.maxSeconds) r.warnings.push(`maxSeconds ${e.caps.maxSeconds} exceeds OpenRouter's ${m.maxSeconds}`);
      break;
    }
    case "fal": {
      for (const ep of [key, e.fal?.t2v, e.fal?.edit].filter(Boolean) as string[]) {
        const st = l.fal.get(ep);
        if (!st) missing(`${ep} is not a fal endpoint`);
        else if (st !== "active") r.errors.push(`${ep} is ${st} on fal`);
      }
      break;
    }
    case "huggingface-router":
      if (!l.hfRouter.has(key)) missing(`${key} is not on router.huggingface.co/v1/models`);
      break;
    case "higgsfield-mcp":
      if (!l.higgsfield.has(key) && !e.verify.note) missing(`${key} is not in the Higgsfield MCP snapshot`);
      break;
  }
  if (o.repoCheck && e.caps.hfRepo && !l.hfRepos.has(e.caps.hfRepo)) r.errors.push(`Hugging Face repo ${e.caps.hfRepo} not found`);
  if (r.errors.length && r.status === "verified") r.status = "missing";
  return r;
}

export function checkCatalog(catalog: ModelEntry[], l: ProviderLists, o: { repoCheck?: boolean } = {}) {
  const seen = new Set<string>();
  const results = catalog.map((e) => {
    const res = checkEntry(e, l, o);
    if (seen.has(e.id)) res.errors.push("duplicate id");
    seen.add(e.id);
    if (!e.runnable && !e.note) res.errors.push("catalog-only entries need a note");
    if (res.errors.length) res.status = "missing";
    return res;
  });
  return { results, ok: results.every((r) => r.errors.length === 0) };
}
