import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";

describe("Preflight script execution", () => {
  it("exits cleanly with missing keys (no network calls)", async () => {
    const scriptPath = path.join(process.cwd(), "scripts", "preflight-models.ts");
    
    // Spawn script with keys explicitly unset
    const child = spawn("tsx", [scriptPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OPENROUTER_API_KEY: "",
        FAL_KEY: "",
        ELEVENLABS_API_KEY: "",
      },
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    const exitCode = await new Promise<number>((resolve) => {
      child.on("close", (code) => resolve(code ?? 1));
    });

    // Should exit 0 (success/skip)
    expect(exitCode).toBe(0);

    // Should mention skipping and keys
    expect(stdout).toContain("Skipping preflight validation");
    expect(stdout).toContain("missing provider API keys");
    expect(stdout).toContain("no network calls made");

    // Should NOT crash on import
    expect(stderr).not.toContain("ERR_UNSUPPORTED_DIR_IMPORT");
    expect(stderr).not.toContain("Cannot find module");
  });

  it("imports model lists without crashing", async () => {
    // Import exactly as the script does
    const { PRESET_STACKS } = await import("../src/lib/versions");
    const { CATALOG } = await import("../src/lib/registry/catalog");
    const { STAGE_DEFAULTS } = await import("../src/lib/registry/index");

    // Assertions
    expect(Array.isArray(PRESET_STACKS)).toBe(true);
    expect(PRESET_STACKS.length).toBeGreaterThan(0);

    expect(typeof CATALOG).toBe("object");
    expect(Object.keys(CATALOG).length).toBeGreaterThan(0);

    expect(typeof STAGE_DEFAULTS).toBe("object");
    expect(Object.keys(STAGE_DEFAULTS).length).toBeGreaterThan(0);

    // Check structure
    const firstStack = PRESET_STACKS[0];
    expect(firstStack).toHaveProperty("id");
    expect(firstStack).toHaveProperty("models");
    expect(typeof firstStack.models).toBe("object");

    // Check STAGE_DEFAULTS has expected stages
    const stages = Object.keys(STAGE_DEFAULTS);
    expect(stages.length).toBeGreaterThan(5);
    
    // Should have some common stages (don't be too specific about exact names)
    expect(stages.some(s => s.includes("script") || s.includes("research"))).toBe(true);
  });

  it("prints actual validation when keys are present", async () => {
    // This test requires real keys - skip if not available
    if (!process.env.OPENROUTER_API_KEY || !process.env.FAL_KEY) {
      console.log("⚠️  Skipping validation test: API keys not set");
      return;
    }

    const scriptPath = path.join(process.cwd(), "scripts", "preflight-models.ts");
    
    const child = spawn("tsx", [scriptPath], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "pipe",
    });

    let stdout = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    const exitCode = await new Promise<number>((resolve) => {
      child.on("close", (code) => resolve(code ?? 1));
    });

    // Should run validation (exit code depends on validation results)
    expect([0, 1]).toContain(exitCode);

    // Should show validation output
    expect(stdout).toContain("Preflight Model Validation");
    expect(stdout).toContain("Checking");
    expect(stdout).toContain("model");
  });
});
