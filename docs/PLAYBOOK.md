# GTM Engine failure playbook

Known failure cases, how to spot them, and the fix. Add a section every time a run fails in a new way.

## 1. Tests fail with `spawn .../ffmpeg-static/ffmpeg ENOENT`

**Symptom:** after a fresh `pnpm install`, the media and typeset tests (and any real render) fail with `ENOENT` on the FFmpeg binary. pnpm prints `Ignored build scripts: esbuild, ffmpeg-static`.

**Cause:** pnpm 10 skips dependency install scripts unless they are allow-listed, so `ffmpeg-static` never downloads its binary.

**Fix (in repo):** `package.json` → `"pnpm": { "onlyBuiltDependencies": ["esbuild", "ffmpeg-static"] }`. If a new dependency needs a build script, pnpm warns on install; add it to that list.

**Related:** pnpm 10 also stopped hoisting ESLint plugins, so `pnpm run lint` failed with "couldn't find the plugin eslint-plugin-react-hooks". `pnpm-workspace.yaml` sets `publicHoistPattern: ["*eslint*"]`. After changing either setting on an existing checkout, delete `node_modules` and reinstall.

**Also:** `tests/media.test.ts` calls a system `ffprobe` (ffmpeg-static does not include it). If those tests fail with `spawnSync ffprobe ENOENT`, install FFmpeg on the host (`brew install ffmpeg` or `apt install ffmpeg`), or put a static `ffprobe` on PATH.

## 2. Bug A: offer line runs off the static ad

**Symptom (Patagonia Better Sweater run, 2026-11-18):** the offer under the headline read "Ironclad Guarantee, Worn Wear repair and resa…" and spilled past the right edge. Vision QA scored 5/10.

**Cause:** `typesetStatic` cut the offer to 60 characters and the ASS subtitle used `WrapStyle: 2` (no wrapping), so a 60-character line at 44px (~1,600px) overflowed the 1080px image. The offer was also cut to 60 characters upstream, mid-word.

**Fix:** `offerLine()` takes the first sentence (keeps prices like `$249.99`) with no character cut. `fitOffer()` fits it inside ~940px on at most 2 lines: it tries 44/40/36px, then drops trailing comma clauses, then cuts at the last whole word. The headline moves up to make room for a second offer line. The claims check now reviews exactly what is printed.

## 3. Bug B: auto-fix paid for re-renders that could not fix text

**Symptom:** QA flagged the cut-off offer. The auto-fix loop sent that note to the image model twice, and both re-renders scored 5/10 again.

**Cause:** the headline, offer and CTA are typeset in code after the image is generated, so the image model cannot change them. All QA notes were passed to it as "fix these issues".

**Fix:** `src/lib/qa-triage.ts` sorts QA notes into **typeset** (headline, offer, CTA, wrapping, cut off, legibility, typos) and **picture** (everything else, including stray text painted into the scene such as labels or signage). Typeset-only failures are fixed by re-typesetting the same scene with tighter type (`typesetStatic(..., { tighter })`), which costs nothing apart from the QA call. Only picture notes go to the image model. When the image model draws the text itself (`STATIC_TYPESET=off`), every note still goes to it.

## 4. Bug C: comparison claims the research doesn't support

**Symptom:** the "Us vs them" direction produced the headline "Only one is guaranteed". Nothing in the research says competitors lack a guarantee, so the creative failed its own claims check, but only after the image had been paid for.

**Fix:**
- `CLAIM_RULE` (in `src/lib/ad-wisdom.ts`) is added to every concept and direction prompt: comparisons and superlatives ("only", "best", "#1", "unlike others"…) need proof in the research or brief. "Us vs them" compares against the customer's old way unless a difference is documented.
- The claims reviewer now explicitly flags unproven comparisons and superlatives.
- `preflightCopy()` (in `src/lib/gate.ts`) runs the claims check on the on-image headline and offer **before** rendering. Unsupported offer clauses are dropped. An unsupported headline is rewritten once, re-checked, and replaced with a research value prop if it still fails. Each change is posted in the Studio chat.

## 5. Silent Reddit voice-of-customer failure (not fixed yet)

`redditText()` in `src/lib/ad-wisdom.ts` swallows every error (rate limits, blocks, JSON changes) and returns empty text. The run continues with no Reddit quotes and nothing tells the user. **Watch for:** voice-of-customer blocks with no `r/...` sources. **To do:** record the failure reason on the run and show it in the UI.

## 6. Cost control: `TOURNAMENT_SIZE`

Each static direction renders `TOURNAMENT_SIZE` takes (default 2, max 4) and keeps the best by QA score. Total image renders ≈ directions × `TOURNAMENT_SIZE` + up to `AUTO_FIX_ATTEMPTS` (2) re-renders per failing direction. Re-typeset fixes add no renders.

- Cheapest test run: `TOURNAMENT_SIZE=1` in `.env.local` and a single direction.
- The pre-render claims check adds 1–3 small text-model calls per static direction (well under a cent).

## 7. Refactor gotchas (PR 2: structure cleanup)

- **Work in a git worktree while the dev server runs.** `next dev` hot-reloads from the working tree, so switching branches in the main checkout changes what localhost:3000 serves. Use `git worktree add ../GTM_VideoGen-refactor <branch>` and `pnpm install` there. The worktree has no `.env.local` (gitignored): symlink it in for a local smoke test and remove it afterwards. Without a session cookie `/studio` returns 307 to `/login`, so log in first to check it renders 200.
- **knip false positives.** `scripts/*.mjs` are CLI entry points and `eslint-config-next` is loaded by name through `FlatCompat` in `eslint.config.mjs`. `knip.json` declares both, so `npx knip` should report nothing.
- **Next.js uses route files implicitly.** `page.tsx`, `route.ts`, `layout.tsx` and `middleware.ts` have no importers. Never delete them because a tool says they're unused.
- **Keep tests' mocks working.** The Studio tests import `POST` from `@/app/api/studio/route` and `vi.mock` `@/lib/*` modules. Mocks apply by module path, so moved code must keep importing `@/lib/store`, `@/lib/ai` and the rest, not copies.
- **Lockfile noise.** Running `pnpm remove` with a newer pnpm 10 adds `libc:` lines to many packages in `pnpm-lock.yaml`. Strip unrelated churn so the diff shows only the dependency you removed.

## 8. Script checkpoint gotchas (PR 3: styles, inspiration match, edits, Jev)

- **Local db tables are arrays.** `.data/db.json` stores each table as an array of rows (`swipes: []`), not an id-keyed object. Setting `db.swipes["id"] = ...` in a script is silently dropped by `JSON.stringify`. The dev server also keeps the db in memory after first read, so edit the file before it starts, or add rows through the API (`POST /api/swipes` with a `note` costs one small vision call).
- **Testing on a copy of real runs.** Start the worktree server with `DATA_DIR=/tmp/<copy> npx next dev -p 3001` after copying the main checkout's `.data`, so test runs never write to the data behind localhost:3000.
- **Rewrite keys drift.** When the text model is asked to fix labeled lines, it sometimes echoes extra detail in the key (`"primary text (max 500 chars)"`). `preflightScript()` matches on the label with any trailing parenthetical stripped. Keep labels plain.
- **One claim can match several lines.** Quoted claims are attributed only to the line(s) with the highest word overlap (≥ 0.6). Word matching is Unicode-aware now, so "décor" is one word, not "d" + "cor".
- **The claims check is not deterministic.** The same copy ("Buy Once. Wear It.") was flagged on one pass and not the next. Treat a clean pass as "nothing obvious", not proof. The script judge's own `unsupported` list is a second net.
- **Jev rarely skips the judge at a 0.8 threshold.** In the Patagonia live check, `hook_in_3s` sat at 0.75–0.77 and `unsupported_claim` near 0.4–0.6 on clean scripts, so every rescore escalated. It flagged the injected "The only fleece that never wears out." at 0.92, the one real problem. Cost was about $0.000044 per call (four questions, ~1,100 input tokens). The skip also needs a clean earlier full review (no checks, unsupported claims or proof problems) by the same judge. A first review always runs the judge, because Jev returns no scores to show. Tune `JEV_MIN_CONFIDENCE` per question on labeled scripts before relying on it to save money.
- **Editing the hook or CTA moves the proof brief.** The operator owns the brief, so a CTA edit updates the script's `proofBrief.cta` and swaps the old CTA text in the final beat. Offer terms are still enforced word for word.

## 9. Video plan checkpoint (PR 4: takes, approval, upscale, real set, local QA)

- **HD used to re-render with a different model.** "Upgrade to HD" sent every shot to the final model at 1080p, so the HD video was a new video, not the one that passed review. **Fix:** HD is now a local Real-ESRGAN upscale of the exact clips in the take a human approved, re-cut with the same voice and music files. Only the QA calls cost money.
- **Several cheap takes.** A click renders up to `takes` 480p takes (default 2) and stops at the first that passes 9/10. Shots that already passed are reused, so later takes only re-shoot failing shots, with the QA notes carried into the prompt. The budget cap covers all takes in one click.
- **Real-ESRGAN speed.** `realesrgan-x4plus` took ~25 s per 486×864 frame on the Mac (a 10 s clip would take ~1.5 h). `realesr-animevideov3` ×2 takes ~0.6–1.3 s per frame (a 10 s video upscales in 3–6 minutes) and is the default. It is set with `REALESRGAN_MODEL`.
- **whisper-cli hangs without stdin.** `whisper-cli -h` (and runs started without closing stdin) hung forever in a non-interactive shell. `wordTimings()` closes stdin and passes `-np`.
- **PySceneDetect output.** `list-scenes -n` prints a "Comma-separated timecode list" on the next line. `parseSceneList()` reads it, and FFmpeg `scdet` is the fallback. An unplanned hard cut inside a single generated clip now fails that shot.
- **Loudness.** The mix was normalised to −17 LUFS. Feeds expect about −14, so `stitchShots` now normalises to −14 LUFS / −1.5 dBTP, and QA flags mixes off by more than 2 LU.
- **Real set without a key.** With `REAL_SET` unset or no `WORLDLABS_API_KEY`, the toggle is disabled and the Video plan shows the reason. A failure mid-build (credits, timeout) posts the error in chat and the storyboard continues without the set. Nothing was signed up for or paid for.
- **Per-shot model.** Each shot can use its own video model. Budget, durations and price are worked out per shot, and a model change re-renders only that shot (it is part of the clip cache key, along with lens and grade).
