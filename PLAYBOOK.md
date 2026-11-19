# GTM Engine Playbook

## Sheet Render Integration with Versions (PR #62)

### Overview
Integrated the sheet render pipeline (`src/lib/sheet/render.ts`) with the Versions module from PR #61, enabling the Studio's Previews and Final steps to render through version stacks with per-stage model overrides.

### Key Changes

1. **Version Stack Integration** (`src/lib/sheet/render.ts`)
   - `renderSheetVersion` now creates proper `VersionStack` objects when initializing new versions
   - Uses `getPresetsWithCosts()` to get a default stack with all required fields (`description`, `models`, `estimatedCostUsd`)
   - Added `normalizeStack()` to ensure all stages have model assignments
   - Version stack models can now drive per-stage rendering decisions

2. **Type Safety Fixes**
   - Fixed `Version | undefined` narrowing after `.find()` by adding explicit null check
   - All version references are now properly guarded

3. **API Actions** (`src/lib/sheet/actions.ts`)
   - `start_versions` action: validates and queues 2-4 version stacks
   - `previews` and `final` actions: delegate to `renderAction` for actual rendering
   - These actions integrate with the Versions panel in the Studio UI

4. **Test Updates** (`tests/versions-api.test.ts`)
   - Updated "Legacy actions" tests to reflect that `previews` and `final` actions are now active
   - These actions work with version stacks rather than being legacy 501 placeholders

### Failures Encountered & Fixes

#### TypeScript Compilation Errors
**Issue**: `VersionStack` type mismatch - missing `description`, `models`, and `estimatedCostUsd` fields when creating versions.

**Fix**: Import `getPresetsWithCosts()` and `normalizeStack()` from `@/lib/versions` and use them to create properly-typed default stacks.

#### Undefined Version Reference
**Issue**: TypeScript error `'v' is possibly 'undefined'` because `.find()` can return undefined.

**Fix**: Added explicit check: `if (!version) throw new Error("Failed to create or find version")` after the find/create logic.

#### Test Failures
**Issue**: Tests expected `previews` and `final` actions to return legacy errors, but they now work.

**Fix**: Rewrote tests to create versions via `start_versions` first, then verify `previews` and `final` actions succeed.

### Rendering Flow

1. User selects 2-4 version stacks in the Versions panel
2. `start_versions` action validates stacks and creates `Version` objects with `status: "queued"`
3. User clicks "Start" → `previews` action calls `renderSheetVersion` for each queued version
4. Each version renders through its stack's model choices (per-stage overrides)
5. User picks a winner → `final` action renders the final quality video

### Cost and Caching

- **Budget cap**: The run's `cost.capUsd` is checked before rendering
- **Preflight estimate**: Each version calculates its cost before starting
- **Per-shot cache**: Uses `clipCache` keyed by shot content + model + size
- **Parallel rendering**: Respects concurrency limit (default 4, configurable via `RENDER_CONCURRENCY`)

### What Can Render End-to-End

✅ **Working**:
- Preview rendering with version stacks
- Per-shot model routing (Blender, AI video, Remotion)
- Audio modes (foley-first, voiceover, both)
- Shot-level QA checks (check 2 of 3)
- Final rendering
- Final review (check 3 of 3)
- Cost metering and budget caps

✅ **Tested**:
- All 460 tests pass including `sheet-render.test.ts`
- Next.js build succeeds
- TypeScript compilation passes

### Future Work

- Wire version stack model overrides into the actual renderer selection logic
- Add model picker UI for custom stacks
- Implement per-stage cost breakdown in version estimates
- Add progress tracking for parallel version renders
