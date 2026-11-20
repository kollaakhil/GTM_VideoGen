/**
 * Vitest setup: ensures all tests run offline by deleting provider API keys.
 * 
 * Without this, 8 tests in fix-gaps-revisions, studio-script-flow and typeset-qa-claims
 * make REAL API calls when keys are set in the shell and fail.
 * 
 * Tests that need a key must set a fake one explicitly.
 */

const PROVIDER_KEYS = [
  "OPENROUTER_API_KEY",
  "FAL_KEY",
  "ELEVENLABS_API_KEY",
  "HIGGSFIELD_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "HUGGINGFACE_API_KEY",
  "REPLICATE_API_TOKEN",
  "STABILITY_API_KEY",
];

// Delete all provider keys before each test file
for (const key of PROVIDER_KEYS) {
  delete process.env[key];
}
