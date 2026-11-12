// End-to-end static run through the Studio API: research -> brief -> concepts -> directions -> generate.
// Usage: BASE=http://localhost:3000 node scripts/e2e-static.mjs <brandUrl> "<goal>"
import fs from "node:fs";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const BASE = process.env.BASE || "http://localhost:3000";
const [brandUrl, goal = "Drive first purchases from cold social audiences"] = process.argv.slice(2);
const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD }) });
const cookie = login.headers.get("set-cookie").split(";")[0];
const api = async (body) => {
  const r = await fetch(`${BASE}/api/studio`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${body.action}: ${r.status} ${JSON.stringify(j)}`);
  return j;
};
const wait = async (id) => {
  for (let i = 0; i < 400; i++) {
    const j = await (await fetch(`${BASE}/api/studio?runId=${id}`, { headers: { cookie } })).json();
    if (j.run.status !== "working") return j;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("timeout");
};
const step = async (body, id) => {
  const t = Date.now();
  const r = await api(body);
  const j = await wait(id ?? r.run?.id ?? r.id);
  const errs = j.run.events.filter((m) => (m.role ?? m.kind ?? m.type) === "error").slice(-2).map((m) => m.text);
  console.log(`${body.action.padEnd(10)} ${((Date.now() - t) / 1000).toFixed(0)}s stage=${j.run.stage} status=${j.run.status} cost=$${j.run.costUsd.toFixed(3)}${errs.length ? " errors=" + JSON.stringify(errs) : ""}`);
  if (j.run.status === "error") throw new Error(`${body.action} failed`);
  return j;
};
let j = await step({ action: "research", brandUrl, goal, format: "static" });
const id = j.run.id;
console.log("run", id, "voc phrases:", j.run.voc?.phrases?.length ?? 0, "sources:", j.run.voc?.sources?.length ?? 0);
j = await step({ action: "brief", runId: id }, id);
j = await step({ action: "concepts", runId: id, format: "static" }, id);
for (const c of j.run.concepts) console.log(` ${c.selected ? "*" : " "} ${Math.round((c.diversity ?? 0) * 100)}% ${c.awareness.padEnd(8)} ${c.format} | ${c.hook}`);
j = await step({ action: "directions", runId: id, format: "static" }, id);
j = await step({ action: "generate", runId: id }, id);
for (const c of j.creatives) console.log(` QA ${c.qa?.score}/10 gate=${c.gate?.pass ? "PASS" : "FAIL"} ${c.gate?.reasons?.join(" | ") ?? ""} :: ${c.url}`);
const pass = j.creatives.filter((c) => c.gate?.pass).length;
console.log(`RESULT ${pass}/${j.creatives.length} passed the gate, total $${j.run.costUsd.toFixed(2)}`);
fs.writeFileSync(`/tmp/e2e-${id}.json`, JSON.stringify(j, null, 1));
