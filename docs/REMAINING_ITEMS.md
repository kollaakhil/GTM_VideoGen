# Remaining Items from User Request

## Status Summary

✅ **Completed:**
1. Fix fix-gaps test (mockResolvedValue, env stub, deterministic)
2. hasCharacter documentation (must check sheet.character?.referenceUrl)
3. Remotion contrast enforcement (4.5:1 minimum, stroke/glow, unit tests)

⚠️  **Partially Complete:**
- Tests: 596 passing (baseline 580, +16 new), 8 skipped (pre-existing)
- TypeScript: Clean
- Build: Succeeds

## Items Requiring Additional Implementation

### 4. Preview Legibility Check
**What's needed:**
- For shots with `text.copy` or `onScreen` content, sample 2 frames with ffmpeg
- Run Tesseract OCR on each frame (already available in `src/lib/media-qa.ts`)
- Compute OCR confidence and word match against expected text
- When confidence < 60 or < 50% words match, add issue: "on-screen text unreadable"
- Mock it in tests

**Where to implement:**
- New function in `src/lib/qa/shot-check.ts`: `checkTextLegibility()`
- Called from `checkPreviewShots()` for shots with onScreen text
- Use existing `localOcrAvailable()` and Tesseract utilities from `media-qa.ts`

**Implementation sketch:**
```typescript
export async function checkTextLegibility(
  shot: PreviewShot & { onScreen?: string },
  deps: { frame: (clip: string, at: number) => Promise<string> }
): Promise<{ readable: boolean; confidence: number; wordMatch: number } | null> {
  if (!shot.onScreen) return null;
  
  // Sample frames at 25% and 75% of shot duration
  const frames = await Promise.all([
    deps.frame(shot.clip, shot.seconds * 0.25),
    deps.frame(shot.clip, shot.seconds * 0.75),
  ]);
  
  // Run OCR on each frame
  const results = await Promise.all(frames.map(f => runTesseract(f)));
  
  // Calculate confidence and word match
  const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;
  const expectedWords = shot.onScreen.toLowerCase().split(/\s+/);
  const foundWords = results.flatMap(r => r.text.toLowerCase().split(/\s+/));
  const matches = expectedWords.filter(w => foundWords.includes(w)).length;
  const wordMatch = (matches / expectedWords.length) * 100;
  
  return {
    readable: avgConfidence >= 60 && wordMatch >= 50,
    confidence: avgConfidence,
    wordMatch
  };
}
```

### 5. Vision-Based Product Visibility Check
**What's needed:**
- In final review, sample 3-4 frames from the final video
- Send to existing vision QA call (same model used for frame scoring)
- Ask: "is the branded product (name) clearly visible? yes/no plus confidence"
- Set product visibility score from that answer
- Fall back to OCR of brand name if vision fails

**Where to implement:**
- Modify `src/lib/stage-gates.ts` `finalChecks()` to accept vision-based hasProductShots
- Add new check in final review that calls vision model
- Update Studio `video.ts` `assembleAndReview()` to compute this

**Implementation sketch:**
```typescript
async function checkProductVisibility(
  videoUrl: string,
  brandName: string,
  deps: { frame: (url: string, at: number) => Promise<string>, vision: (frame: string, question: string) => Promise<string> }
): Promise<{ visible: boolean; confidence: number }> {
  // Sample 3 frames evenly distributed
  const times = [0.25, 0.5, 0.75]; // fractions of duration
  const frames = await Promise.all(times.map(t => deps.frame(videoUrl, t * duration)));
  
  // Ask vision model about each frame
  const results = await Promise.all(frames.map(f => 
    deps.vision(f, `Is the branded product "${brandName}" clearly visible in this frame? Answer with yes/no and confidence 0-100.`)
  ));
  
  // Parse responses and compute overall visibility
  const visible = results.filter(r => r.includes("yes")).length >= 2;
  return { visible, confidence: /* extract from responses */ };
}
```

### 6. UI Components
**What's needed:**

**A. Brand Step - Product Photos Display:**
- Location: `src/components/studio/brand-node.tsx` or research display
- Show `run.research.productPhotos` as thumbnails
- Each with source link and remove button
- Remove button calls action that filters photo from `run.storyboardPhotos`

**B. Shot Sheet Step - Character Reference Display:**
- Location: `src/components/sheet-studio/sheet-table.tsx` or sheet display
- Show `sheet.character.description` as text
- Show `sheet.character.referenceUrl` as image thumbnail
- Only display when character exists

**C. Remotion End Card - Product Image:**
- Location: `remotion/Root.tsx` or EndCard composition
- Pass first product photo from `refs` to end card props
- Display beside brand name when available
- Update `src/lib/remotion-shot.ts` to include product photo in card props

**Implementation notes:**
- UI changes require React/Next.js component work
- Need to wire through data from run/sheet to components
- Test in development mode with `pnpm dev`

## Testing Requirements

All items should have:
- Unit tests for core logic (text legibility, vision checks, contrast already done)
- Integration tests with mocked models
- No new skipped tests
- All existing tests passing

Current test status: 596 passing (+16 new), 8 skipped (pre-existing), 0 failed
