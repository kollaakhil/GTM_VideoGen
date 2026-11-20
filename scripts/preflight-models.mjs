#!/usr/bin/env node
/**
 * Preflight check: verify that key model endpoints are reachable before running tests.
 * Uses plain fetch (no @fal-ai/client dependency) and makes no paid calls.
 * 
 * Usage: node scripts/preflight-models.mjs
 * Exit 0 if all checks pass, 1 otherwise.
 */

const ENDPOINTS = [
  { name: "OpenRouter models list", url: "https://openrouter.ai/api/v1/models" },
  { name: "OpenRouter video models", url: "https://openrouter.ai/api/v1/videos/models" },
  { name: "fal models list", url: "https://api.fal.ai/v1/models?limit=10" },
  { name: "Hugging Face router", url: "https://router.huggingface.co/v1/models" },
];

async function checkEndpoint(endpoint) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const res = await fetch(endpoint.url, {
      headers: { "user-agent": "gtm-engine-preflight" },
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    if (res.status === 429) {
      console.warn(`⚠️  ${endpoint.name}: rate limited (${res.status})`);
      return { ok: true, warning: true };
    }
    
    if (!res.ok) {
      console.error(`❌ ${endpoint.name}: ${res.status} ${res.statusText}`);
      return { ok: false };
    }
    
    const data = await res.json();
    const hasData = data && (data.data || data.models);
    
    if (!hasData) {
      console.error(`❌ ${endpoint.name}: unexpected response format`);
      return { ok: false };
    }
    
    console.log(`✓  ${endpoint.name}`);
    return { ok: true };
  } catch (e) {
    if (e.name === "AbortError") {
      console.error(`❌ ${endpoint.name}: timeout`);
    } else {
      console.error(`❌ ${endpoint.name}: ${e.message}`);
    }
    return { ok: false };
  }
}

async function main() {
  console.log("Running preflight model checks...\n");
  
  const results = await Promise.all(ENDPOINTS.map(checkEndpoint));
  const failed = results.filter(r => !r.ok).length;
  const warnings = results.filter(r => r.warning).length;
  
  console.log(`\n${results.length - failed} passed, ${failed} failed, ${warnings} warnings`);
  
  if (failed > 0) {
    console.error("\n❌ Preflight checks failed. Some model endpoints are unreachable.");
    process.exit(1);
  }
  
  console.log("\n✓ Preflight checks passed");
  process.exit(0);
}

main();
