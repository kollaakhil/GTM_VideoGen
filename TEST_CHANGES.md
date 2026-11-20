# Test Expectation Changes in tests/sound-concept-driven.test.ts

## Change Made

**File:** `tests/sound-concept-driven.test.ts`
**Test:** "imports the preflight script successfully"

### Before
```typescript
expect(content).toContain("OpenRouter");
expect(content).toContain("fal models");
```

### After
```typescript
// Should validate all model IDs from the codebase
expect(content).toContain("PRESET_STACKS");
expect(content).toContain("STAGE_DEFAULTS");
expect(content).toContain("CATALOG");
// Should check modalities
expect(content).toContain("modality");
expect(content).toContain("deprecated");
```

## Reason

The test was checking for the **simple preflight script** that only verified 4 provider endpoints were reachable ("OpenRouter models list", "fal models list", etc.).

PR #83 **upgraded** the preflight script to comprehensively validate **every model ID** from:
- PRESET_STACKS
- STAGE_DEFAULTS  
- CATALOG
- render-deps fallbacks

The new script checks:
- Model exists
- Not deprecated
- Output modality matches role

The old assertions `toContain("OpenRouter")` and `toContain("fal models")` were **correct for the old script** but became **incorrect for the upgraded script**. The upgraded script imports TypeScript modules and validates individual model IDs, so the test now checks for:
- `PRESET_STACKS` - confirms it reads from versions.ts
- `STAGE_DEFAULTS` - confirms it reads from registry/index.ts
- `CATALOG` - confirms it reads from registry/catalog.ts
- `modality` - confirms it validates output modality matches role
- `deprecated` - confirms it checks for deprecated models

This is **not weakening the test** - it's updating expectations to match the comprehensive validation the upgrade delivers. The new assertions verify the script does MORE (validate every model ID) not less (just check endpoints are reachable).
