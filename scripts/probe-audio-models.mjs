#!/usr/bin/env node

/**
 * Probe fal audio models to verify they're available and estimate costs.
 * Keeps total spend under $0.30 by using minimal test calls.
 */

import * as fal from "@fal-ai/client";

const FAL_KEY = process.env.FAL_KEY;
if (!FAL_KEY) {
  console.error("❌ FAL_KEY environment variable is required");
  process.exit(1);
}

fal.config({ credentials: FAL_KEY });

const AUDIO_MODELS = {
  // Music models
  "fal-ai/stable-audio-3/medium/text-to-audio": {
    stage: "music",
    params: { prompt: "Test instrumental", duration: 5 },
    maxCostUsd: 0.05,
  },
  
  // SFX models (new defaults)
  "mirelo-ai/sfx2.0/text-to-audio": {
    stage: "sfx",
    params: { prompt: "door close", duration: 2 },
    maxCostUsd: 0.05,
  },
  "elevenlabs/sound-effects/v3": {
    stage: "sfx", 
    params: { text: "footsteps", duration_seconds: 2 },
    maxCostUsd: 0.01,
  },
  
  // Deprecated models (verify they're actually dead)
  "fal-ai/mmaudio-v2": {
    stage: "sfx (deprecated)",
    params: { prompt: "test", video_url: "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAu1tZGF0AAACrwYF//+p3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NCByMzA5NSBiYWVlNDAwIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyMSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTEwIHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAABR2WIhAAz//73aWAuLKlXuP7nWCH2N6yBdkdxzwOHn5/5aWAx8S5NdwYfBsLf0OxGEOXnj5bpwkj7HQYPsEPWLEeWLo5gAmE=", duration: 2 },
    maxCostUsd: 0.01,
  },
  "fal-ai/stable-audio-3/small/sfx/text-to-audio": {
    stage: "sfx (deprecated)",
    params: { prompt: "test", duration: 2 },
    maxCostUsd: 0.05,
  },
};

const results = [];
let totalSpent = 0;

for (const [modelId, config] of Object.entries(AUDIO_MODELS)) {
  console.log(`\n🔍 Probing ${modelId} (${config.stage})...`);
  
  try {
    const start = Date.now();
    const result = await fal.subscribe(modelId, { input: config.params });
    const duration = Date.now() - start;
    
    if (result.audio_file?.url) {
      console.log(`✅ Success (${duration}ms)`);
      console.log(`   Output: ${result.audio_file.url.substring(0, 80)}...`);
      results.push({
        model: modelId,
        stage: config.stage,
        status: "available",
        durationMs: duration,
        estimatedCostUsd: config.maxCostUsd,
      });
      totalSpent += config.maxCostUsd;
    } else {
      console.log(`⚠️  Unexpected response format`);
      console.log(JSON.stringify(result, null, 2));
      results.push({
        model: modelId,
        stage: config.stage,
        status: "unexpected_format",
        durationMs: duration,
        response: result,
      });
    }
  } catch (error) {
    const message = error.message || String(error);
    const isDeprecated = message.includes("deprecated") || message.includes("no longer available");
    
    console.log(`${isDeprecated ? "❌ DEPRECATED" : "⚠️  ERROR"}: ${message}`);
    
    results.push({
      model: modelId,
      stage: config.stage,
      status: isDeprecated ? "deprecated" : "error",
      error: message,
    });
  }
}

console.log("\n" + "=".repeat(80));
console.log("📊 PROBE RESULTS");
console.log("=".repeat(80));

const available = results.filter((r) => r.status === "available");
const deprecated = results.filter((r) => r.status === "deprecated");
const errors = results.filter((r) => r.status === "error" || r.status === "unexpected_format");

console.log(`\n✅ Available: ${available.length}`);
for (const r of available) {
  console.log(`   - ${r.model} (${r.stage})`);
}

console.log(`\n❌ Deprecated: ${deprecated.length}`);
for (const r of deprecated) {
  console.log(`   - ${r.model} (${r.stage})`);
  console.log(`     ${r.error}`);
}

if (errors.length > 0) {
  console.log(`\n⚠️  Errors: ${errors.length}`);
  for (const r of errors) {
    console.log(`   - ${r.model} (${r.stage})`);
    console.log(`     ${r.error || "Unexpected format"}`);
  }
}

console.log(`\n💰 Estimated total spend: $${totalSpent.toFixed(2)}`);

const exitCode = deprecated.some((r) => r.model.includes("mmaudio") || r.model.includes("stable-audio-3/small")) &&
                 available.some((r) => r.model.includes("mirelo-ai/sfx2.0") || r.model.includes("elevenlabs/sound-effects"))
  ? 0
  : 1;

if (exitCode === 0) {
  console.log("\n✅ All checks passed: deprecated models are dead, replacements are live.");
} else {
  console.log("\n❌ Check failed: verify deprecated models and replacements.");
}

process.exit(exitCode);
