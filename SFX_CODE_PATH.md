# SFX Default Code Path: Proof They Only Fire When Matched

## Question
Do the cola sounds (pop/fizz/pour/clink) in `src/lib/sfx.ts:17-56` fire as defaults for non-beverage brands, or only when the shot description matches?

## Answer: ONLY WHEN MATCHED

### Code Path Proof

**1. Pattern Definitions (src/lib/sfx.ts:48-53)**
```typescript
const CUES: { kind: SfxKind; re: RegExp }[] = [
  { kind: "pop", re: /\b(crack|cracks|cracking|pop|pops|popping|open(s|ing)? the can|tab)\b/i },
  { kind: "pour", re: /\b(pour|pours|pouring|stream|streams)\b/i },
  { kind: "fizz", re: /\b(fizz|fizzing|fizzes|bubbl\w*|carbonat\w*|foam\w*|sparkl\w*)\b/i },
  { kind: "clink", re: /\b(ice|clink\w*|glass(es)? (touch|meet))\b/i },
];
```

**2. Pattern Matching Entry Point (src/lib/audio/mode.ts:62-68)**
```typescript
export function foleyActions(s: AudioShot): string[] {
  const line = (s.sfx ?? "").trim();
  if (line) return line.split(SPLIT).map((x) => x.trim()).filter(Boolean);
  // No sound line: derive one action per distinct sound the picture implies.
  const text = `${s.visual ?? ""} ${(s.beats ?? []).join(" ")}`;
  return FOLEY_PATTERNS.filter(({ re }) => re.test(text)).map(({ kind }) => kind);
}
```

**KEY LINE 67:** `FOLEY_PATTERNS.filter(({ re }) => re.test(text))`

This line **filters** the patterns. If the regex does NOT match the text, it is NOT included.

**3. Pattern Application (src/lib/audio/mode.ts:77-83)**
```typescript
for (const [i, s] of shots.entries()) {
  const list = foleyActions(s).slice(0, 5);  // Gets ONLY matched patterns
  const usable = Math.max(0.2, s.seconds - LEAD - TAIL);
  let placed = 0;
  for (const [j, phrase] of list.entries()) {
    const kind = kindOf(phrase);  // Maps matched phrase to kind
    // ... places the cue ...
```

### Non-Beverage Brand Example

**Input:** A SaaS brand video showing a laptop, clicking, typing, screen transitions
- Shot text: "hand clicks mouse, screen transitions, user smiles"

**Regex Tests:**
- pop regex `/\b(crack|cracks|cracking|pop|pops|popping|open(s|ing)? the can|tab)\b/i` → NO MATCH (no "crack", "pop", "can", or "tab" in text)
- pour regex `/\b(pour|pours|pouring|stream|streams)\b/i` → NO MATCH (no "pour" or "stream")
- fizz regex `/\b(fizz|fizzing|fizzes|bubbl\w*|carbonat\w*|foam\w*|sparkl\w*)\b/i` → NO MATCH (no "fizz", "bubble", "sparkle")
- clink regex `/\b(ice|clink\w*|glass(es)? (touch|meet))\b/i` → NO MATCH (no "ice", "clink", "glass")

**Result:** `FOLEY_PATTERNS.filter(({ re }) => re.test(text))` returns **empty array** → No pop/fizz/pour/clink SFX generated

### Matching Happens, Not Defaults

The code explicitly:
1. **Builds text** from shot description: `const text = \`${s.visual ?? ""} ${(s.beats ?? []).join(" ")}\`;`
2. **Filters patterns** by regex match: `.filter(({ re }) => re.test(text))`
3. **Maps to kinds** only after match: `.map(({ kind }) => kind)`

There is **NO fallback** that adds pop/fizz/pour/clink unconditionally. If the text doesn't match the regex, the SFX is not included.

### Other Patterns Available

Non-beverage brands would match OTHER patterns:
- `click` → `/\b(click\w*|switch\w*|snap\w*|button|latch\w*|dial|toggle|flick\w*)\b/i`
- `thud` → `/\b(thud|lands?|set(s)? down|placed?|drops?|impact|slam\w*|hits?|knock\w*|tap\w*)\b/i`
- `slide` → `/\b(slides?|sliding|glides?|sweeps?|drag\w*|rotat\w*|spins?|turns?)\b/i`

A SaaS video with "mouse clicks, keyboard taps, drawer slides open" would get **click**, **thud**, **slide** - NOT pop/fizz/pour/clink.

## Conclusion

The cola sounds (pop/fizz/pour/clink) are **regex-matched**, not defaults. They only appear when the shot description contains matching words like "crack", "pour", "fizz", "bubble", "ice", "glass". A shoe brand, SaaS product, or furniture video with no beverage-related words will get **zero** pop/fizz/pour/clink sounds.
