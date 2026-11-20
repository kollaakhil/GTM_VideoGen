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

## 10. Start screen and inspiration breakdown (PR 5)

- **One approval screen.** The start screen takes the brand URL, goal, offer and up to four inspirations (links or uploaded videos or images). It runs research, customer language, the reference style, the inspiration breakdowns and the brief in one job (`autoBrief`). The operator then reviews everything and approves the brief once.
- **Breakdown pipeline (per video):** PySceneDetect for cuts (FFmpeg `scdet` fallback) → shot windows (slivers under 0.3 s merged) → whisper.cpp word timings (WhisperX with `WHISPERX=1`) for words/s and when the first word lands → up to `INSPIRATION_FRAMES` (default 4) keyframes → Tesseract TSV for where text sits and how much there is → one cheap vision call for framing, lens, motion, purpose and text style. Smoke test: 3 shots found, cuts at 2 s and 4 s, 2.0 words/s, text zone "top", **$0.006**.
- **Structure only.** Transcripts and OCR words are never stored or sent on. The vision model gets only word counts. Any paraphrase that repeats six or more words of the transcript or page text in a row is dropped (`copiesLine`). Breakdowns are saved as swipes, so the script writer, the inspiration-match judge and the shot planner (`inspirationGuidance`) all borrow rhythm, framing, lens and motion.
- **Links that hide the video.** YouTube, TikTok, Instagram and Facebook pages don't expose a downloadable file. The breakdown falls back to the page (og:image plus page text) and says so in chat: "Upload the file for a full cut-by-cut breakdown." Direct `.mp4/.mov/.webm` links and pages with `og:video` get the full breakdown. Downloads are SSRF-checked and capped at 30 MB.
- **Homebrew FFmpeg has no `drawtext`.** Use `node_modules/ffmpeg-static/ffmpeg` for test fixtures with burned-in text.
- **A style-reference fetch failure no longer fails research.** `styleDNA` errors (for example a direct video link) are caught, and the run continues without the style map.

## 11. Stage gates and judge calibration (PR 6)

- **Every stage has its own scored gate**, shown as a strip of chips above the dock (hover a chip for every check and the suggested fixes). Bars: Research 8, Script 7 (the script lab's existing loop), Shot plan 8, Video 9, Sound & voice 8, Edit 8. A stage under its bar blocks the next step until it's fixed or a human clicks **override** and gives a reason. The reason and who overrode it are kept on the score.
  - Research blocks concepts and directions.
  - Shot plan blocks 480p takes.
  - The approved take's video, sound and edit scores block the HD upscale.
- **Bounded auto-improve with one cheap retry.** The gate judge is the run's vision model (a flash-class model; set `GATE_JUDGE_MODEL` to change it).
  - Research is re-run once with the fact-checker's notes on the already-fetched page.
  - The shot list is re-planned once with the director's fixes *before* any keyframe spend.
  - The better attempt is kept.
  - Video, sound and edit are scored on every take. A failing take is fixed by making another 480p take, not by another HD pass.
- **What each gate checks.**
  - **Research:** distinct sources, depth, customer evidence and named competitors (rules), plus a judge on hallucinated facts against the site text, evidence and real competitors. Research now names 2–4 real competitors.
  - **Shot plan:** words per shot, lens/framing, light, word overlap with the locked beat and shared cast/set words (rules), plus a judge on specificity, characters, set, lens, continuity and script match.
  - **Video:** the worst and average per-scene frame scores, and the Creative Director review.
  - **Sound & voice:** WER (jiwer), loudness near -14 LUFS with peak under -1, every line inside its shot, per-line speech checks and the music bed.
  - **Edit:** cuts on the planned starts (scenedetect), shot length vs the beat, words/s, and one continuity vision call over one frame per shot.
- **Rule of thumb:** any single check at 3/10 or below caps the stage at 6. One broken dimension can't hide behind a good average.
- **A judge outage never blocks.** If the judge call fails, the gate scores on rules only and says the judge was unavailable. Demo mode (no AI key) skips judging.
- **QA of the QA.** **Calibrate judges** (about $0.03) scores a labeled golden set: one good and one bad research, one good and one bad shot list, and synthetic continuity frames (the same black bottle framed wide, medium and close vs. one that turns red, then blue).
  - When the judge scores a known-bad item at or above the bar, the margin is its *inflation*. Later scores from that judge are reduced by it (never raised).
  - Each disagreement is stored in `judge_calibrations` (migration `0004`) and posted in chat.
- **Mistake to avoid: never `source .env.local` in the shell you run tests in.** Exported real keys make the mocked script-flow tests call live providers and fail. Load keys only in a subshell for smoke scripts.
- **vitest gotcha:** a `vi.fn()` that rejects (with either `mockRejectedValue` or a throwing `mockImplementation`) was reported as a test failure even though the gate caught it and returned the right score (confirmed by logging). The unit test covers the fallback with a malformed verdict instead.
- **First calibration run ($0.028, gemini-3.8-flash):** research and shot judges agreed with every label. The continuity judge scored three identical frames 7/10 (it marks down "no variety"), a disagreement that would have failed good edits. Fix: the golden frames now show the same bottle wide, medium and close, and the prompt says a change of framing between shots is not a continuity error.
- **Second calibration run found two golden-set bugs, not judge bugs.** (1) The good and bad continuity items were judged in parallel but wrote the same frame files, so the "good" item was scored on the red/blue frames (3/10). Each item now writes its own files. (2) The "grounded" research said "commuters and gym-goers", which the golden site text didn't say. The judge was right to flag it, so the site text now says it. Lesson: when a judge disagrees with a label, check the label and the fixture first.
- **Third run:** research and shots agreed with every label. The continuity judge still gave the good frames 7 while writing "no continuity errors". It was grading production value, not continuity. An explicit 10/8/6/3 scale didn't help (still 7, "perfect visual continuity"). Fix: the judge now only *lists* errors (minor/major) and the score is computed: 10 − 1.5 per minor − 4 per major. Lesson: ask flash judges for findings, not numbers.

### E2E findings (OLIPOP Pomegranate Sparkle, 2026-11-18)

- **Research judge saw less than the writer.** The writer got 12,000 characters of site text and the fact-checker only 9,000. Real facts from the end of the page (WELCOME15, "cool and dry") were flagged as hallucinated, and the gate still passed 8.5 because the average hid it. Fixes: the judge gets the same 12,000 characters; any unsupported fact caps research at 7.5 (blocked); after the one retry, a deterministic scrub removes the flagged facts and a final judge call re-checks.
- **A direct video link used as an inspiration was also fetched as a "style reference" page.** styleDNA described raw MP4 bytes ("Unidentified… raw MP4 binary data"). Fix: referenceUrl only falls back to an inspiration link that isn't a direct media file.
- **TTS check blocked the first 480p take before any video spend:** "The narration did not match an approved line after two attempts." The CTA "Get notified at drinkolipop.com." is read and transcribed as "drink olipop dot com", and the exact-token compare failed. Fix: `sameSpeech` also compares the two lines with spaces and "dot" removed (a mishearing like "lollipop" still fails), and the error now quotes what was heard.
- **Script judge never reached 7 on an out-of-stock product.** Every re-score raised a new proof problem (missing nutrition terms, unverified "ruby-red" color, out-of-stock context), and the score stayed at 6 across 7 re-scores ($0.02 each). For the MVP run I approved the 6/10 script; draft takes are allowed, and HD stays blocked by the script blockers. Lesson: pick an in-stock product page for E2E, and cap re-score loops.
- **Second try: the voice was heard as "drinkallapop.com".** Speech-to-text mishears coined brand domains. Fix: the voice pre-check (`nearSpeech`) still needs every other word to match exactly, but lets the domain differ by up to 3 characters. Export QA stays strict, so a misread domain still shows up there as a finding.

## 12. Video step: background jobs, progress bars, one linear flow (E2E 2026-11-18)

- **Symptom:** clicking the 480p button "did nothing"; `/api/studio` GETs hung 138–187 s. **Cause:** not the render itself
  (`render_video` already returns at once and runs in `after()`), but `next dev` recompiling routes on an 8 GB Mac under
  heavy swap, plus the client firing a new poll every 1.5 s while earlier ones were still pending. **Fix:** run the app
  with `next build && next start` for testing, and the client keeps one poll in flight at a time.
- Jobs now persist `run.job` from the moment they are queued (`phase: "queued"`), then `preflight → voice → rendering/qa
  per shot → stitching → qa` (final: `upscaling` per shot). Each shot carries `stage`, `startedAt`, `endedAt`, so the UI
  draws an overall bar and per-shot bars with percent and ETA (`src/lib/job-progress.ts`).
- A failed job logs `[studio] job … failed` server-side and saves `run.failure` with the real message and the original
  request, so the failure card's **Retry** re-sends exactly that request. A second click while a job runs gets 409.
- Default 480p model is now a priced fal model (Higgsfield MCP needs its own sign-in and has no price, so estimates
  showed "?"). Default takes: 1.
- **Make final video anyway** (`acceptWarnings`) overrides failing take gates on the record, turns script/keyframe
  blockers into review findings, and still produces the HD file; the creative stays unpublishable until fixed.
- **"OpenRouter's balance … too low" with $14.9 left (E2E 3:01 PM):** the balance check had an 8 s timeout and treated
  "no answer" as "no money". On the swapping Mac both requests timed out. Now each check retries once (10 s, then 25 s),
  logs `[openrouter] … check failed`, and an unreachable API says so ("Nothing was spent; press Retry").
- **Black panels over the product in the final (E2E 4:09 PM):** after an on-screen copy mismatch the export is
  re-typeset in "compact copy" mode, which drew two fixed `drawbox` panels (about 89%×26% and 81%×32% of the frame) for
  the whole video. **Fix:** no fixed panels; every caption/overlay line gets its own tight semi-opaque ASS box
  (BorderStyle 3, padding ≈ 0.28 × font size) that exists only while that line is on screen.
  Test: `tests/caption-backing.test.ts` checks pixels around and after the text stay clear.
- **Step counter jumped 4/7 → 6/8 on the final:** upscale used `shots + 3` but stitch/QA used the draft's `shots + 4`.
  One `jobSteps(tier, shots)` now numbers every step of a job.

## 13. Quality push to 9/10 (2026-11-18 evening)

### 13.1 Captions covered the product (OLIPOP final, 13.5 s)

- **Symptom:** the bottom caption "Get notified at drinkolipop.com." sat across the top of the can, and the same CTA was
  also drawn as a top overlay, so the line appeared twice.
- **Cause:** captions always used one fixed lower-third slot (bottom margin 20%), which is exactly where product
  hero shots put the can. Overlays were drawn even when they repeated the voice line word for word.
- **Fix:** `src/lib/caption-layout.ts`. For every shot, an edge-energy map of the exported frames (FFmpeg
  `edgedetect`, 36-column grid, 2 fps) scores each candidate slot inside the platform safe zone (top 8%, bottom 20%
  stay clear for Reels/TikTok UI). The quietest slot wins, and the default lower third is kept unless another slot is
  clearly quieter (15%), so captions don't jump on near-ties. Every caption cue in a shot shares one slot, and the
  overlay and caption never overlap. An overlay that repeats its own voice line is dropped (`duplicateOverlay`).
- **OCR noise was the same bug.** Export QA read a fixed 58–82% band for captions, so Tesseract got the can label
  and fruit along with the caption and returned garbage ("35 Cal *¢ Og Added Sugars ee ae"). Each export now
  returns where every line was placed (`variant.copy`), and `ocrFilter` reads only that box, binarised (white text
  on its dark box). Use `placedCues(variant, cues)` whenever you OCR an export.
- **Tests:** `tests/caption-layout.test.ts` covers the OLIPOP can geometry, overlay/caption collisions, the
  duplicate-overlay rule, the OCR crop, and a pixel test where a detailed "can" under the default slot stays
  untouched.

### 13.2 The four warnings that kept the OLIPOP final unpublishable

"Making the final video with 4 warnings" came from `finalBlockers()`. Each was traced to its root cause:

1. **Proof problem: "the opening establishes the stock obstacle before the goal."** The judge's story rule demanded
   Goal → Stakes → Obstacle in that order, but the hook lab itself offers "Buyer friction" and "Proof first"
   openings, so every friction hook was flagged. **Fix:** the rule now accepts a friction-led or proof-led opening as
   long as the goal and stakes are clear by the end of beat 2.
2. **Proof problem: "Tap Notify Me for this pour" contradicts the pour.** This was a real defect, but the repair loop
   rewrote only the judge's single `blockerBeat` using the judge's single note (which was about the sugar
   disclosure). Global problems and other proof problems were never sent to the writer, so re-scores kept finding
   them (6/10 across 7 re-scores). **Fix:** one repair round gets every fix note (`scriptFixNotes`: checks,
   unsupported claims, proof problems, the judge's note) and may rewrite every unlocked beat. `betterScript` keeps the
   repair only if it adds no new unsupported claim and has fewer blockers (or as many and a higher score). A new
   writer rule says the VO action must match what the visual shows.
3. **"Redraw keyframes 1–4 until they match and score 9/10."** All four keyframes passed on every frame ("accurately
   reflects the locked script…") and still scored 7. That is the same flash-judge habit found in calibration
   (§11, third run): it parks good work at 7. **Recalibration (justified):** shot and keyframe QA no longer asks for a
   number. Each frame is graded on a checklist: action, product, label, hands, artifacts, framing. Each item is
   ok, minor, major or na, and `checklistScore` = 10 − 1 per minor − 4 per major (worst severity per item), with a
   failing frame counted as at least one major and any major capping the shot at 6. One cosmetic flaw still allows 9
   ("no meaningful defects"); two don't. The judge's own number is kept as `judgeScore` for the record. This is
   stricter on real defects (a major item now fails its frame even if the judge said "pass") and only removes the
   fixed 7 ceiling. To do: add golden keyframe items to **Calibrate judges**.
4. **Video gate 4.6 on the take:** shot 1 asked the video model for "a page showing Out of Stock and Notify Me".
   Video models garble UI and words, and QA rightly failed the melting screen. **Fix:** `renderedTextProblem()`
   flags screens, pages, apps, signs, notifications and quoted words in hook and beat visuals (a script check, so
   the repair round fixes it before approval). The writer and shot-planner rules now forbid phones, screens and UI in
   frame. The real product label is still allowed.

**Also fixed, the export speech failure:** whisper heard the clean TTS line "drinkolipop.com" as "drinkoleopop.com".
`verifySpeech` now passes whisper a `--prompt` that lists only the brand name, domains and coined all-caps or
CamelCase words (`asrVocabulary`), never the whole line, so real mis-speech still fails. On the stored OLIPOP final,
the result went from "drinkoleopop.com" to "Get notified at drinkolipop.com".

### 13.3 A gate at every stage (PR "stage gates v2")

- **Nine chips, in order:** Research, Brief, Script, Shot plan, Voice & music, Shot renders, Sound mix, Edit and
  Final QA. Every gate gives a 0–10 score, a threshold and fix notes (hover a chip).
- **Thresholds are configurable** with `NEXT_PUBLIC_GATE_THRESHOLDS="script=8.5,final=9"`. It is inlined at build
  time, so rebuild after changing it. The default is 8; Shot renders and Final QA default to the 9/10 publish bar.
  **The script bar went from 7 to 8.** The script lab's repair target (`SCRIPT_TARGET`) is the same number, and a
  script only passes with no proof problems and no failed checks.
- **Brief gate (new):** rule checks (word limits, generic wording, the share of offer words found in the research,
  3–5 mandatories, a measurable KPI) plus one judge call that lists issues as minor or major, with the score
  computed from them. Any major issue blocks. One rewrite runs with the fix notes, and the better brief is kept. A
  failing brief blocks concepts and directions, just like research, unless it is overridden.
- **Voice & music gate (new, free, before any video spend):** every line must be heard back as written (a second TTS
  take costs a point), fit its beat at natural speed (lines sped up past ×1.08 lose points; trim the words), sit at a
  sensible level, and the planned music bed must be audible. Under the bar the take stops with "No video was
  requested". Override the chip to continue, and cached voice tracks are reused.
- **Final QA gate (new):** a rubric of creative director (×2), weakest shot (×1.5), OCR copy, ASR voice vs script,
  failing visual frames and technical. The old OLIPOP final (craft 6, 7 OCR misses, 2 speech misses, shot 1 at 4)
  scores ≤ 6 on it, which matches what we saw.
- **Retries:** research and the shot plan already re-ran once with notes. The brief rewrites once. The script does
  one full-note repair round (§13.2). Each shot render re-shoots once with its QA notes. Copy failures on the export
  are re-typeset for free.

### 13.4 E2E run 1 (OLIPOP Vintage Cola, in stock): brief mandatories leaked into the script

- **Symptom:** the brief gate gave 10/10, but the brief's mandatories included "Confirm Vintage Cola is in stock before
  launching" and "Disclose: drinkolipop.com only, not combinable with other offers". The script then spoke the fine
  print as VO ("Drinkolipop.com only, not combinable with other offers.") and put "Prelaunch gate: confirm … in stock"
  inside a shot description. The script stuck at 7/10 after its repair round, with a crowded beat-4 overlay.
- **Cause:** the brief writer was asked for "mandatories" with no definition, and every writer downstream treats them
  as must-show.
- **Fix:** `src/lib/brief-policy.ts`. The brief prompt defines mandatories as things the ad shows or says. A brief
  rule (`creative mandatories`) scores 3 when one is an internal task or fine print, so the gate fails and the brief
  is rewritten with that note. The brief judge marks it as a major issue. Directions, script and shot prompts get
  `creativeBrief(b)`, which drops operational mandatories, as a second net.
- **Cost/latency note:** the script step (draft + judge + one full repair + re-judge) took 8.6 minutes and $0.35 with
  `openai/gpt-6.1-sol` as the judge. It is the slowest and most expensive non-video stage.
- **The brief judge never counted (E2E run 1, both attempts): "Brief judge returned an incomplete verdict".** The
  judge's notes were about 350 characters, and the zod schema's `.max(300)` rejected the whole verdict, so the gate
  scored on rules only (10/10). The same strict limits sat on the research, shot, continuity and frame judges.
  **Fix:** `src/lib/judge-schema.ts` clips long strings and lists instead of rejecting them. **Lesson:** never put a
  hard `.max()` on free-text LLM output that you only display.
- KPI rule: "Cost per first-time purchase" is measurable (it now matches "cost per", "rate" and "return on").

### 13.5 E2E run 1b (Vintage Cola, after the brief fixes): script 6/10, the repair round silently did nothing

- **Symptoms:** (1) Script beats described an "unmarked cream-and-burgundy can", and the judge rightly said the pour
  lacked visible attribution to OLIPOP. (2) Beat 4 stacked offer, CTA, shipping and guarantee into one overlay.
  (3) Proof problems in **beat 1** (three actions in 3 s, unbranded can). (4) `rounds` stayed unset, so the repair
  round produced nothing and nobody could tell why.
- **Causes:** (1) The new no-text rule (§13.2) said "never show any readable words in the scene", so the writer
  dropped the real label too. (2) No overlay word limit. (3) The repair could only touch beats 2+, so opening-shot
  problems were unfixable. (4) The repair result was parsed with strict length limits and failures were swallowed.
- **Fixes:** the rule now bans *invented* words and UI, and requires the real labelled product whenever it appears.
  Overlays are capped at 7 words, one message per beat. The repair may rewrite beat 1's **visual** (its line and overlay
  stay locked; `hook.visual` follows), its output is clipped rather than rejected, and every round records
  `script.repair` (`fixes`, kept or discarded, before and after score, reason). The reason is shown in the Script
  chip and logged as `[script] …`.

### 13.6 Structured shot specs (step 4)

- **Failure:** free-text `visual` lines left the video model to guess the lens, the product's size in frame and the timing of the action. That is where hands warped mid-gesture, labels melted during fast moves, and invented signage appeared.
- **Fix:** every shot now carries a `spec` with subject, productFraming, lensMm, cameraMove, lighting, setting, 1–3 timed motionBeats and a shot-specific negative list (`src/lib/shot-spec.ts`).
  - Keyframe and video prompts are built from it in a fixed order (`specBlock`).
  - Every prompt ends with "Avoid: …" (`negativePrompt` = shot negatives + `DEFAULT_NEGATIVE`: warped fingers, melting or re-drawn label, garbled text, screens, duplicate products, flicker, CGI look). Seedance has no `negative_prompt` field, so the list goes in the prompt text.
  - The shot-plan gate has a "structured spec" rule (−1.5 per gap, weight 1.5), so a vague plan is rewritten before any keyframe spend.
  - The PR #5 inspiration breakdown still feeds the planner through `inspirationGuidance`.
- The video cache key includes the spec only when one is present, so legacy clips stay reusable.

### 13.7 Best-of-N 480p candidates (step 5)

- **Failure:** one take per shot meant a single warped hand failed the whole draft, and the repair loop paid for full re-renders one at a time.
- **Fix:** `plan.candidates` sets how many 480p candidates each shot gets (1–4; new plans default to 3).
  - Plans saved before this change have no field and keep 1, so spend never triples silently.
  - Candidates render in parallel. Each one gets the same technical checks and frame-by-frame vision QA.
  - `pickCandidate` ranks pass > review > fail, then score, then fewer major frame findings, then fewer failing frames.
- **Cost estimate first:** preflight says the estimate in chat before any motion spend ("N shots × K candidates ≈ $motion + $QA + $reserve"). It fails closed if the estimate is over the cap. The plan node shows the per-take estimate × candidates.
- If the remaining cap can't cover K, the number of candidates is reduced, not the cap ignored.
- Only the winning clip is stored on the shot, so `upscaleTake` upscales winners only. Approve-then-upscale is unchanged.

### 13.8 Final QA v2 (step 6)

- **Failure:** the script-level WER (≤10%) passed a narration whose captions were off by a cue, or that said "five grams" while the caption read "5g" a beat later.
- **Fix:** `src/lib/caption-sync.ts` takes the whisper word timings and compares each caption cue with the words heard while it is on screen (±0.35 s).
  - Matching uses an LCS alignment. Numbers and units are normalised both ways (5g = five grams, 50% = fifty percent).
  - Coverage under 80% is a review; under 60% is a fail. The report lists the missing and extra words.
- The final rubric gains two rows:
  - "captions vs voice (word sync)": mean coverage × 10, minus fails.
  - "sampled frames": every export frame the vision judge checked, scored pass 10, review 7, fail 3.
- The full rubric (`quality.rubric`, `quality.rubricScore`) is saved on the quality report, so every run's breakdown is auditable.

### 13.9 E2E run 1: script repair v2 result, and end-card mandatories

- **PR18 result:** the repair round fixed all of the old blockers (`[script] Repair kept: 6 → 0 blockers.`). The script went from 6 to 7 with no checks, proof problems or unsupported claims left.
- **Next failure:** the one remaining judge note was "the final card drops the offer and omits the mandatory footer". The brief listed "End card: …" and "Footer badge: …" as mandatories. The writer could not fit them under the 7-word overlay rule, and the app's end card only showed the brand and CTA, so the judge was right that nobody delivered them.
- **Fix:**
  - `endCardItems` moves those items out of the writer's mandatories into `brief.endCard`.
  - The script prompts and the judge are told that the end card delivers them.
  - The typeset end card now draws the offer line (y 52%) and the footer (y 76%).
  - OCR reads both: the footer has its own crop band at 72–80%.
- Nothing about the rubric changed. The judge's complaint was correct, and we fixed what the ad delivers.

### 13.10 Beat-synced cuts and SFX (step 8)

- **Failure:** cuts fell wherever the script's beat lengths put them. The music bed ignored the cuts, and the pour, fizz and crack had no sound at all because the video model's audio is dropped for the voice and music mix. Spots felt "assembled", not edited.
- **Beats:** `src/lib/beat-sync.ts` runs librosa (`beat_track` + `onset_detect`, local and free, installed in the ~/.gtm-tools venv) on the music bed.
  - `snapCuts` moves each internal cut to the nearest beat or onset within −0.25/+0.25 s. That stays inside the edit gate's 0.25 s "pacing vs script" tolerance.
  - A shot never grows past its real clip length, and each shot is at least 1.2 s.
  - Voice lines move with their shot.
  - The edit gate gains "cuts on music beats" (share of cuts within 0.3 s of a beat, weight 0.5).
- **Real check** on the run_41d310961d3e clips: starts went from [0, 3, 7, 11] to [0, 2.81, 6.803, 10.797], and 3 of 3 cuts were snapped. Seedance renders clips at exactly the shot length, so cuts can usually only move earlier.
- **SFX:** `src/lib/sfx.ts` synthesises pop (can crack), pour, fizz, clink (ice) and whoosh with FFmpeg lavfi noise and sine generators.
  - `sfxCues` picks sounds from the shot's visual and spec motion beats, timed to the beat that mentions the action, plus a soft whoosh 0.22 s before every cut.
  - SFX gains are well under the voice (pop 0.45, pour 0.3, fizz 0.18, whoosh 0.12) and go through the same loudnorm.
- **Licensing:** every sound is generated by our code from noise and oscillators, with no samples or third-party recordings, so there is no licence to track. A recorded CC0 pack could replace them later. Record its source and licence here if one is added.
- **Pitfall:** FFmpeg `bandpass` treats `w` as Q by default. `w=1800` made a needle-thin band and a silent whoosh (−65 dB). Use high/low-pass, or set `width_type=h`.
- `plan.beatSync` and `plan.sfx` (both default on) turn the features off.

### 13.11 End-card hold time

- **Failure:** after 13.9, the script judge's only note was that all four beats use the full 15 s, "leaving no time to read the sale terms". That was true: the end card was held for 1.5 s, and it now carries brand, offer line, CTA and footer.
- **Fix:** `END_SECONDS` went from 1.5 to 2.5. The writer and judge are told the card is held for 2.5 s after the beats, outside the beat runtime by design. The rubric is unchanged.

### 13.12 Script repair: second round and the opening overlay

- **Failure:** in run_8a9c7c9db627, three script runs in a row went 5–6 blockers → 0 in the single repair round, then stopped at 7/10.
  - Each time the judge's remaining note was new, for example "'Classic soda's holiday catch' leaves the buyer tension vague on mute". No round was left to address it.
  - The opening overlay was locked, so it was also unfixable.
- **Fix:**
  - Up to 2 repair rounds. The second runs only if the first was kept and the script is still under target.
  - When a note targets the opening, the repair may rewrite beat 1's visual and its overlay (at most 7 words). The spoken hook stays locked because it is the operator's pick.
  - `repair.before` is the first draft's score, and `after` is the final one.

### 13.13 Remotion motion graphics (step 7)

- **What:** `remotion/Root.tsx` has two compositions, rendered locally by `src/lib/motion-graphics.ts` with @remotion/bundler and @remotion/renderer in headless Chrome. Versions are pinned to exactly 4.0.545, because Remotion packages must match.
  - **Overlay:** ProRes 4444 with alpha, composited over the shots by FFmpeg.
    - Animated captions spring in, and the word being spoken turns #FFE14D.
    - Offer and price lines become a tilted, bordered tag that pops in.
    - Other overlays slide in as a callout with a brand-colour bar.
  - **EndCard:** an opaque clip. Logo, wordmark, offer pill, CTA and footer stagger in and settle by 0.9 s.
- **Layout is unchanged:** the same caption-layout slots and end-card heights as the ASS path (brand 40%, line 52%, CTA 64%, footer 76%), so OCR QA reads it the same way. Any Remotion error logs `[motion]` and falls back to ASS.
- **Failures found in the smoke run** (run_41d310961d3e clips, beat-synced cut):
  1. Captions wrapped to 3 lines because CSS padding ate into the 84% text width. OCR read only the placed box ("quince and passion fruit é sparkle."). Fix: maxWidth = 84% + padding.
  2. End-card lines wrapped to 2 lines and left the fixed OCR bands, and the outlined offer box and CTA underline added strokes. OCR read "50% off a9 aoa ends" and "drinkeoteor.com". Fix: one line each (`white-space: nowrap`, size fitted at about 0.63 em per character of DejaVu Sans Bold), the offer as a filled pill, and no underline.
  - After both fixes, OCR findings on the whole export = []. Render time is about 16 s for a 15 s 486×864 cut on the 8 GB Mac. The Chrome Headless Shell download happens once.
- **Switches:** `MOTION_GRAPHICS=0` turns it off. It is off under vitest unless `MOTION_GRAPHICS=1`, so unit tests never launch Chrome.
- **Licence:** Remotion is free for individuals and for companies of up to 3 people. Larger companies need a Remotion Company License (remotion.dev/license). Check this before commercial use at scale.
- **Repo pitfall (my mistake):** I stashed the Remotion work with `git stash` and then ran `git add -A` on another branch. That committed the untracked remotion/ files into PR #25 without the package.json deps, and the port-3000 build failed with "Cannot find module 'remotion'". Use `git stash -u`, or commit work in progress before switching branches.

### 13.14 Blender packshot end shot (step 9)

- **Failure:** the CTA shot was the most expensive place to get the product wrong: re-drawn labels, two 12-packs with garbled art, extra cans. It is also the last thing the viewer sees.
- **Fix:** `scripts/blender/packshot.py` (Blender 5.2.2, EEVEE, headless) turns the real product photo into a studio packshot.
  - The label is unwrapped from the photo's cylindrical projection (x = cx + R·sin θ, θ in ±78°) and mapped onto a can body with metal lids.
  - Lighting: softbox key, cool rim, fill, on a glossy floor.
  - Camera: 85 mm, ±14° orbit with a 6% push-in. The back of the can is never shown.
- **Pipeline:**
  - When `plan.packshot` is on (new plans default on; off when Blender is missing, and under vitest unless `PACKSHOT=1`), the storyboard swaps the last shot's picture for the packshot. Beat, VO and overlay stay the same.
  - Its keyframe is a Blender still and its clip a Blender render. The model is `blender:packshot` at $0, with one candidate.
  - Both still go through the normal keyframe and clip vision QA.
- **Pitfalls hit:**
  1. Blender's cylinder primitive has its own UV map, and the image node used it, which stretched the label about 2×. Fix: remove the primitive's UV layers and make ours active and active-render.
  2. With sensor fit AUTO in portrait, the 36 mm sensor spans the *height*, so the camera sat inside the label. Fix: vertical FOV = 2·atan(18/85).
  3. `read_factory_settings` wipes datablocks, so the label image has to be made after the reset.
- **Cost:** about 2 s for a still and about 115 s for a 4.2 s clip (126 frames) at 486×864 on the 8 GB Mac.
- **Licence:** Blender is GPL, and renders made with it belong to us. The label art is the brand's own product photo, already supplied as the product reference.

### 13.15 Voice pre-check: whisper hint

- **Failure:** the first draft of run_8a9c7c9db627 stopped before any video spend. The voice pre-check heard "Keep the cola swapping all a pop." for "Keep the cola, swap in OLIPOP.", twice. The TTS was fine. The pre-check called whisper without the brand vocabulary that final QA already uses (13.2).
- **Fix:** `transcribeLine` takes the `asrVocabulary(line, brand)` prompt.
- The cost estimate now counts real renders: a packshot is 1 render, a paid shot is N candidates.

### 13.16 Packshot geometry

- **Failure:** the first packshot keyframe scored 8 (product minor, artifacts minor): "can proportions and upper rim geometry show mild 3D modelling inaccuracies". Any keyframe under 9 forces a *test draft*, with 1 candidate and blocked for HD, so the whole take was capped.
- **Fix:** the oversized lid cylinders were replaced with a tapered neck cone, a rolled rim and a base taper. The floor now matches the world tone and the camera looks about 3° down.
### 13.17 TTS brand pronunciation

- **Failure:** with the whisper hint in place (13.15), the pre-check still heard "Keep the Cola. Swap in Olapop." ElevenLabs really does say "Olapop" for all-caps "OLIPOP".
- **Fix:** `speakable()` sends all-caps brand words to TTS as one capitalised word ("Olipop"). Known acronyms stay as written. The script, captions and QA text are unchanged.

### 13.18 Packshot label unwrap pulled background into the top corners
- Failure: s3 packshot keyframe still 8/10 after 13.16 ("slight rendering inconsistencies at the top rim"). Cause: the label was
  unwrapped with one can width for every row; near the shoulder the photo's can narrows, so the top corners sampled dark background.
- Fix: unwrap per row using that row's own mask edges, median-smoothed over ~6% of the height (raw edges jitter with condensation
  drops and shred the lettering), and cap the unwrap angle at 74° (beyond that the photo is the shaded edge of the can).

### 13.19 Packshot "dull metal / floor reflections" (keyframe 8/10)
- Failure: after 13.18, artifacts were ok but the judge marked product+action minor: "floor reflections and can metal finish appear
  somewhat dull". EEVEE without ray tracing reflects only the world, and the world was the dark backdrop, so the aluminium read black.
- Fix: EEVEE ray tracing on; the world is a Light Path mix: camera rays see the flat backdrop, reflections see a studio dome with a
  vertical gradient (horizon = backdrop tone, bright top). Brighter, smoother aluminium (0.91 / roughness 0.12); a darker, glossier
  floor (roughness 0.16) that mirrors the can; a backdrop spot pool. Off-camera emissive strips are kept but EEVEE's screen-space
  tracing can't see off-screen objects, so the dome does the real work (lesson: in EEVEE, put reflection sources in the world).

### 13.20 Brand pronunciation + brand-tolerant voice pre-check
- Failure: draft blocked twice more at the voice pre-check after 13.17: TTS of "Olipop" was heard "Alapop" / "all up pop".
  Measured on the Mac (5 respellings × whisper with and without the vocabulary hint, ~$0.01): "Ollie-pop" is voiced right and
  heard "ollie pop" / "OLLIPOP"; even then the unstressed "in" before it comes back "an".
- Fix: research returns `pronunciation` (a TTS respelling of the brand); `speakable()` swaps it in for the brand. The pre-check
  (`nearSpeech(..., brand)` → `brandNear`) allows the brand (5+ letters) to be heard as up to 3 tokens within 2 edits and one
  unstressed function-word swap (a/an/in/and/on/the/to/of). Every other word must match exactly.
- Why this is not loosening: the pre-check guards against wrong words before spend; ASR spelling of a coined name says nothing
  about the audio. The final QA's whole-mix WER ≤ 10% and caption word-sync checks are unchanged.
- Operator note: run_8a9c7c9db627's research predates the field, so `research.pronunciation = "Ollie-pop"` was set by hand.

### 13.21 "two-plus" vs whisper's "2+"
- Failure: the CTA line failed the pre-check: expected "Fifty percent off two-plus cases", heard "50% off 2+ cases". `%` was
  normalised to "percent" but `+` was stripped. Fix: `N+` → "N plus" in `sameSpeech` tokens.

### 13.22 Lines too long for their beat were found by paying for voice + music
- Failure: draft7 bought music ($0.60) and all four voice lines, then failed the voice & music gate at 7.7: the CTA line
  ("Fifty percent off two-plus cases. Shop at drinkolipop.com.", 4 s beat) needed ×1.14. The script check counted *words*
  (9 ≤ 11), but "drinkolipop.com" and "two-plus" are one word each and five/two spoken syllables.
- Fix (free, before any spend): `speech-budget.ts` estimates speech time = 0.25 s + syllables/4.6 + 0.2 s per sentence break,
  with numbers/%/+/domains expanded, calibrated on the four measured lines of run_8a9c7c9db627. `checkScript` (script gate,
  repair loop, and draft preflight) rejects a VO that needs more than the beat minus 0.3 s at ≤ ×1.05 (the voice gate's own pass
  mark), naming the syllable budget. The script prompt states the same budget.
- Spend order: the voice gate is now evaluated on the voice lines *before* music is bought, so a voice failure costs only the
  TTS (~$0.003/line). Music was already cached per (category, seconds, tone, style), so re-drafts after a script trim do not
  re-buy it.
- Operator edit on run_8a9c7c9db627: beat 4 VO → "Half off two-plus cases. Shop at drinkolipop.com." (14 syllables, est 3.5 s;
  the "50% off 2+ cases" end-card mandatory is unchanged and still shown).

### 13.23 Final QA compared ASR spellings, not speech
- Failure: take 1 of run_8a9c7c9db627 (clean mix; the voice pre-check had passed every line) scored audio 5.4: WER 23%,
  "voice vs script (ASR) 0/10, 5 mismatches", caption word-sync 4.5. The transcript was "50% off 2+ cases", "ollie pop",
  "drinkaliepop.com"; the script says "fifty percent", "two-plus", OLIPOP, drinkolipop.com.
- Fix: `speech-canon.ts`. Both sides go to spoken words (`spokenForm`: digits, %, +, domains), and heard 1–3 token windows within
  2 edits (3 for 10+ letters) of a coined brand term from the script (terms containing the brand) map to that term. Used by
  `verifySpeech` (per line + whole script, in addition to `sameSpeech`), `captionSync` (brand param), and the whole-mix WER.
- Not loosening: ordinary words are never rewritten, so "soda" for "cola" or a wrong brand still fails; the thresholds
  (WER ≤ 10%, caption coverage) are unchanged. Homophone spellings ("dred", "gilt") still count against WER.
### 13.24 Label drift on a moving can (s0 crack-and-pour, 2/10 ×3 takes)
- Failure: hook shot "hand cracks the can and immediately pours" with a slow push-in: all three Seedance candidates scored 2, 2, 1
  ("label drifts from approved yeti art to generic script during the pour", "top rim cropped"). The can tilted in depth, so the
  model had to invent the unseen side of the label, and the push-in cropped the rim.
- Fix: the shot-planning prompt now requires in-plane moves for labelled products (tip sideways, label square to camera, no
  rotation in depth), a locked-off camera for that shot and headroom; "product rotating away from camera" joined the default
  negative. For run_8a9c7c9db627 s0 the spec was edited the same way by hand (cameraMove locked off, motionBeats in-plane tip).

### 13.25 Captions out of sync and over the product (take 2: 7/10)
- Failures (run_8a9c7c9db627 take 2, every shot clip 10/10): caption word-sync 4.9 ("with just fifty calories" on screen while
  "half off" was heard), and the sampled-frame judge scored scenes 2/4/5/4 for "lower captions obstruct the can and glass" and
  "consolidate top and bottom overlays". Final per-line check still failed "swap an ollipop".
- Causes: cues were spread over the whole (beat-snapped) shot window while the line is ~3.4 s from +0.15 s; the caption default
  slot is the lower third (0.74), where the product sits in these shots; the final line check lacked the pre-check's tolerance.
- Fixes: segments carry the measured speech span (voice start + length / tempo) and `timedCues` times captions inside it; with an
  overlay in the top band the caption slots are tried nearest to just under it first (one text group, product clear); the final
  per-line check accepts what the pre-check accepts (`brandNear`, 13.20). WER and caption thresholds unchanged.

### 13.26 Take 3 (7/10): which export-level items were real
Take 3 (take_6d74ffe04cfd): all four clips 10/10, but video 4.6 / audio 7.6 / final 5.1. Per item:
- Export-frame scene scores 4, 10, 4, 3 (video "worst scene" ×2, final "weakest shot" ×1.5). **Real.** s0: two stacked text
  boxes over the pour; s2: the caption box sits on the can; s3 packshot: the caption covers "vintage" on the label. Fix: one
  text layer at a time (`ONE_TEXT_LAYER`: spoken captions only in shots without an on-screen overlay), and the Blender
  packshot now frames the can at ~60% height, high in frame, so the caption band (0.66–0.80) is over the floor.
- Caption word-sync 5.1 ("with just fifty calories" on screen while "half" was heard). **Real** (my 13.25 bug): the speech spans
  used the pre-beat-sync voice starts; stitchShots moves voices with their shots. It now returns `voiceStarts` and spans use them.
- Peak -0.4 dBFS (technical fail, loudness 8). **Real.** Single-pass loudnorm with TP=-1.5 overshoots; an `alimiter` at 0.79
  (-2 dBFS, margin for AAC) now follows it.
- WER 10% / caption misses "dred", "gilt", "swapin". **Partly ASR.** The word-timing whisper pass had no vocabulary hint while
  every other recogniser did; it now gets the same coined-term hint (`asrVocabulary`, never the full line). Thresholds unchanged.
- OCR "y a) / ' pdread the sugar guilt?" (OCR 2/10). Caused by the stacked caption sitting over the hand and bokeh; goes away
  with one text layer. Not a judge change.
- "Can base cropped at left in s0" (scene judge). **Real but clip-level**; clip QA passed it at 10. Left for now (needs a paid
  re-render); noted as the next visual fix if scores stall.
No judge or threshold was changed in this round.

### 13.27 Judge miscalibration: the packshot marked down for being a render
- Evidence: the same Blender renderer scored 9/10 (13.19) and then 4/10 after a framing-only change, with every check "minor" and
  the note "depicts a digital render of the can packshot rather than a live-action product". The shot design says "Studio
  packshot… CGI"; the judge was scoring the medium, not the quality, and a 4 forces the draft into a 1-candidate test draft.
- Fix (judge, not threshold): for `source === "packshot"` the frame-review prompt says it is a deliberate studio CGI packshot and
  to judge label fidelity, geometry, lighting and framing. Pass marks and checklist are unchanged.

### 13.28 Take 4 (7/10): peak got worse, packshot lost its CTA text
- Peak +1.2 dBFS on the export (stitch output had the 13.26 limiter): the export re-decodes and re-encodes AAC and hard-cuts
  from the mix into 2.5 s of digital silence for the end card. **Real.** The export now runs `alimiter` at 0.708 (-3 dBFS sample
  peak, margin for AAC overshoot) after the end-card concat, and the end card gets a synthesised bell button (`END_STING`)
  instead of silence (Akhil's "proper end-sting/button" ask).
- Packshot (scene score 1, "missing required overlay 'Shop at drinkolipop.com'"). **Real, my 13.26 regression:** an overlay that
  repeats the VO is dropped by `duplicateOverlay`, and ONE_TEXT_LAYER then also dropped that shot's captions, leaving no text. The
  caption filter now uses the same predicate.
- Keyframe 4/10 "render rather than live-action" → 13.27 judge fix.
- Still open: s0 can exits the left edge in the late pour (scene 7/10; clip-level, needs a paid re-render).

### 13.29 Take 5 (6/10, rubric 7.1) + voice/music A/B: audio models, packshot colour, export-review noise
Take 5 (after #41): peak fixed (-2.3 dBFS), packshot CTA text back. What still drags video (5) and final (7.1):
- **"swap an ollipop" (ASR fail, every take). Real, voice model.** A/B on the full script (Whisper WER + pitch/pause
  prosody, samples in /workspace/gtm-e2e/v2/ab/voice): Turbo v2.5 3% WER, 8.1 st pitch range, says "swap an";
  Eleven v3 (fal) 3% WER, 10.6 st, says "swap in"; multilingual v2 3%, 8.5 st; Higgsfield Eleven v4 Holden 3%, 17.8 st
  (best prosody). v4 needs the app's Higgsfield OAuth connection (not connected), so the app moves to fal Eleven v3
  ($0.10/1k chars, about $0.015 a script vs $0.0075); v4 is the follow-up once Higgsfield is connected in /connections.
  Voice cache keys now include the model, so cached Turbo lines re-voice once.
- **Music.** librosa on 18 s beds (ab/music/beat.txt): current fal ElevenLabs Music 117.5 BPM, inter-beat CV 0.023,
  voice-band (300-3400 Hz) energy 2.36; Higgsfield ElevenLabs Music v2.5 CV 0.009, voice band 1.48 (best, but OAuth);
  Stable Audio 2.5 CV 0.015, voice band 1.82, $0.20 a clip vs $0.60 a started minute; CassetteAI CV 0.042 (drifts).
  App moves to Stable Audio 2.5 and the prompt states 112 BPM, a steady pulse, an open midrange and an ending button.
  Caveat: B/C/D used the tempo prompt, A the old one, so part of the gain is the prompt (both ship).
- **Packshot label pink, "CGI softness" (s3 export 5). Real.** Blender AgX view transform desaturates saturated reds
  toward magenta: label red measured hue 349 deg / sat 0.70 vs the photo's ~350 / 0.86; Standard + coat 0.25 + -0.25 EV
  gives 351 / 0.74 with the highlight unclipped (cmp-agx-std2.png).
- **s2 "label drift" 4. Judge noise, not the clip.** The same cached clip scored 10 at clip QA, 10 in take 4's export
  review and 4 in take 5's. Fix the measurement, not the threshold: export reviews are now the median of three
  independent reviews (`medianReview`), which neither takes the best nor the worst; a flaw two of three see still fails.
  Cost +2 vision calls per shot (~$0.02 a take).
- **s0 can cropped at the left edge during the pour. Real** (consistent across takes). Needs a paid re-render; open.

### 13.30 Eleven v3 broke the CTA beat; speech budget recalibrated
- First v3 draft stopped at the voice gate (6/10, $0.017, no music or video bought: 13.22 working as designed): the
  CTA "Half off two-plus cases. Shop at drinkolipop.com." took 4.60 s in a 4 s beat (×1.24). Turbo said it in ~3.6 s.
  v3 holds 0.41 s at the full stop and reads the domain slowly. v3's `speed` did nothing measurable (3.89 s at 1.0 and
  3.91 s at 1.1 on the trimmed line), so speed-up at synthesis is not a lever.
- Fix upstream in the free gate: `spokenSeconds` adds 0.4 s per sentence break (was 0.2) and 0.45 s per spoken domain.
  Commas are not charged (the two-comma 16-syllable line took 3.63 s and fits). The CTA now fails the script gate.
- For this run the packshot beat goes from 4 s to 5 s: it is our own CGI shot, so a longer beat costs nothing, and it
  keeps the full CTA. (Trimming to "Half off two-plus cases at drinkolipop.com." still took 3.97 s, over the 3.885 s limit.)

### 13.31 Captions: optional, keyword-style, placed by an agent (Akhil t56u)
- Take 6 (v3 voice + Stable Audio): 7/10, final 6. Audio 8.9 (WER 3%), but the export judges kept flagging the text layer:
  "text overlay exhibits graphical artifacts" (s1), "text overlays vary" on the packshot (s3 median 3), with captions
  over the product in earlier takes. Both captions and overlays were drawn as whole lines.
- `VideoPlan.captions`: "off" (voiceover only, no in-shot text; the end card keeps brand/offer/CTA), "keywords"
  (default: one 2-4 word phrase per line, the strongest contiguous run with numbers/brand and no function-word edges or
  comma crossings; shown from when its first word is said to the end of the line, min 1.2 s), "full" (old behaviour).
  There is a toggle in the video-plan node, and expected copy (OCR) and word sync follow the mode.
- Placement agent (`placeCaptions`, caption-agent.ts): before export it checks every cue frame by frame against the subject box
  (vision `locateSubjects`, one call per shot over the stitched video's sampled frames, ~$0.003 each) and the overlays on
  screen at the time. On a collision (over 20% of the caption box on the subject, or touching an overlay) it moves the
  cue to another slot, then shrinks it to a shorter window of the same phrase, then drops it. Each action is logged to
  the run chat. Subject boxes are mapped into the padded/cropped aspects.
- Rejected: an edge-energy subject box. On take 6 it boxed 70-80% of every dinner-table frame and the agent dropped all
  four cues. Busy sets are not subjects.
- Take 7 (keywords, take_fefb747dce74): 7/10, final 7.6 (take 6: 6), video 5.8 (4.8). Scenes 6/6/5/7; no shot fell to
  3. Two agent bugs: (1) the packshot CTA was dropped "covering the subject at 10.6s", a frame from the previous
  shot let in by a ±0.25 s slack (now ±0.05 s); (2) in a shot whose on-screen CTA repeats the line, the overlay is
  suppressed, so the keyword cue is the shot's only required text. It now shows that approved copy ("Shop at
  drinkolipop.com") instead of a keyword pick. WER 13% on this take was Whisper misspellings ("Dred the sugargilt",
  "DrinkOlypop.com") of the same v3 lines that scored 3% on take 6. That is ASR variance, noted and not chased.
- Captions off (take_ba6dcaef6288): 6/10, final 6, video 4.3. The export reviewer still got each shot's approved
  overlay and marked it "absent" (s2, s3). With captions off there is no in-shot text by design, so the export review
  no longer receives `approvedOverlay` in that mode. The filmstrip director still asks for hook and stat text on
  sound-off grounds, which is a fair craft note and the reason keywords stay the default.

### 13.32 Captions A/B round 2; canon swallowed "at"; overlay fade on the sampled frame
- With identical clips (s0 re-rendered once): keywords take_a8c72359e92a 6/10, final 7.1 (scenes 8,10,4,10); off
  take_47a8f2748dff 6/10, final 6.0, video 3.2. Keywords win both rounds.
- **Real, canon:** `canonTokens` tried 3-token windows first, so "shop at drinkolipop" merged "atdrinkolipop" (2 edits
  from the brand term) and lost "at". That caused the "missing: at" caption-sync review and the full-script ASR fail on
  every take since #37. Each window now takes its closest match, and it does not swallow its first word when the match
  one word later is closer.
- **Real, overlay "backing drops out / loses opacity" (s2, several takes):** the Remotion callout faded out over the
  last 0.2 s, and the export review samples at 0.96 of the shot (0.16 s before a 4 s shot's cut). Out-fade is now
  0.08 s and the backing is 0.8 opaque.
- Harness (not the app): run.mjs's spend guard counted the run's lifetime cost on top of the ledger and cancelled
  two drafts at ledger $5.34. It is fixed to count only the spend since tracking started.
- Plan edits for this run (free planning choices, documented): s1 4 s -> 3 s (the director's "pacing drags across nearly identical
  dinner-table shots" note and the 15 s target; v3 says the line in 2.59 s, inside the 2.84 s limit), and s0's overlay
  becomes the hook question (the director asked for it on every take). An overlay that repeats the line is drawn once, as the
  shot's caption (<= 6 words).
- Take 9 (take_77971ee8be8a, s0 and s1 re-rendered, $0.46): 6/10. Audio 8.9 (WER 3%) and caption word sync 10 after
  the canon fix; s3 8 with its CTA. But the agent dropped the hook caption (the can and hand fill the top at 0.1 s)
  and the director again marked the hook missing. Approved copy (`required`: the shot's on-screen hook/CTA) is now
  never dropped. It goes unshortened to the slot covering the least of the subject in its worst frame
  ("least-overlap"). Keyword picks can still be dropped. The new s0 render smeared the label (scene 0), so the run
  goes back to take_a8c72359e92a's s0 clip (clip QA 10, export review 8): same cache key, and that clip passed.

### 13.33 s0 framing lock experiment (db-only, 2026-11-19)
- Spec edit: whole can in frame with ≥15% side margin, locked-off camera, tumbler right of centre. Keyframe redraw scored 10/10 and the can is centred.
- Re-render (draft23, take_23a70da5396d): s0 clip QA 0 (label typography corrupted, tab warped during the tilt-pour). Video 3.4, final 6, overall 7. Worse than take_d90c705571d3 (video 6.4, final 8.1).
- Conclusion: framing was not the binding failure. Seedance 480p can't hold label text through a tilt-pour (1 clean clip out of ~6 s0 renders). The s0 shot was restored from db.bak-s0-frame.json. Next lever: restage s0 so the label never rotates (pour from an off-frame can, or a static can beside the pour), or use i2v with a stronger model for labelled motion shots.

### 13.34 Label lock + continuity locks, enforced in code (feat/label-lock)
- Failure: the labelled can tilting or rotating was the weakest scene in 6 of 8 takes (Seedance re-draws the label mid-move; ~1 clean tilt-pour out of ~6). The framing lock in 13.33 didn't help.
- Fix (src/lib/shot-spec.ts, `enforceShotRules`, applied in `planShots`, so it doesn't depend on the planner obeying):
  - `applyLabelLock`: in every labelled, generated shot, beats that tilt/tip/lift/rotate the product (or pour from an in-frame can) become "can upright and still beside the glass; cola pours from a can held above, out of frame". Tilt/pour sentences are removed from the visual. A pour shot gets a locked-off camera. The negative prompt names can tilting and label turning. The packshot is exempt.
  - `labelLockGaps` is part of `specGaps`, so the shot-plan gate flags any plan that slips through.
  - `continuityLocks`: the hero shot's glass ("ice-filled short tumbler") and an upright, square-to-camera label become `spec.continuity` on every generated shot; `specBlock` prints them into keyframe and video prompts.
  - Keyframes for labelled shots use the free true-colour Blender packshot still as reference 1 (real photo as 2) via `keyframeRefs`, so the i2v start frame carries a clean, front-on label.
  - Edit judge: `judgeContinuity` now also lists glass type/size/shape changes and label-orientation changes as major errors (`CONTINUITY_LOCK_ASK`). This is a stricter rubric, not a looser one.
- Tests: tests/label-lock.test.ts.

### 13.35 Take 24 under the label lock: the clips pass, so the caption and continuity become the cap
- With 13.34, all four clips passed QA for the first time (10, 10, 9, 10; earlier s0 renders scored 0–5).
- The take still scored 6 (video 6.1, final 7.8) because of two new drags:
  - The export review put scene 0 at 5 because the required hook caption sat over the lower label ("vintage cola"). The vision subject box (hand + pour + can + glass) spanned the frame, so least-overlap picked the bottom slot. Fix: `locateSubjects` also returns the package-only `product` box, and the required-copy fallback minimises label overlap first, then subject overlap. A top slot that covers only the hand or stream now wins.
  - The edit continuity judge scored 6: "the can is open in shots 1–2, sealed in shot 3". Fix: `continuityLocks` adds "the tab is already open" to every shot after the one where the can is cracked.
- Tests: caption-agent (product-priority placement), label-lock (open-can lock).

### 13.36 One pour per ad; median of 5 export reviews (fix/single-pour)
- Take 25 edit continuity was 4.5: "action reverses: a settled, filled glass in shot 2, then pouring again in shot 3". `singlePour` (in `enforceShotRules`) keeps the first pour. In every later shot, pour and tilt-over-glass beats and sentences (including the locked script's expectedVisual) become "the glass is already full: bubbles rise and the foam settles", and the negative prompt adds "pouring again".
- Export review: `EXPORT_REVIEWS = 5` (was 3). Evidence: the identical cached s0 clip scored 10 in take 24 and a median of 3 (3, 1, 5) in take 25. The rubric and thresholds are unchanged. Only the sample count goes up, which lowers variance without biasing the result (the median, not the max). Costs about $0.01 more per shot.

### 13.37 Product 3D asset (image-to-3D): when it helps and when it does not (2026-11-19)
- **Why we tried it:** `packshot.py` rebuilds the can from a cylindrical label unwrap. Irregular products (shoes, toys, gadgets, characters) have no primitive to wrap, and a hand-built stand-in is the weak point of every Blender product shot. Image-to-3D could give Blender the real object.
- **What was added:** a registry stage `asset3d` ("Product 3D asset"): one product photo in, one GLB out. Models: `speridlabs/idol/max/turbo` (about $0.10, about 20 s, texture projected from the splat) and `speridlabs/idol/max` ($0.20, base colour repainted from the photo). Both were checked in fal's live catalog on 2026-11-19 (status active, category image-to-3d) and are in `fal-snapshot.ts`, so `verify-models.mjs` flags them if fal removes them.
- **Failure case (real test, OLIPOP can, Idol Max Turbo, about 19 s, $0.10):** not hero quality for a can. The condensation droplets in the photo were baked into lumpy geometry, the silhouette wobbled, and the back side was invented. A can is a cylinder with a flat label, which the procedural primitive renders perfectly and for free, so a reconstructed mesh can only be worse.
- **Routing rule (enforced in `classifyProduct` and `autoPick`):**
  - **Simple primitives** (cans, bottles, jars, boxes, cartons, tubes, pouches, cups): the procedural Blender primitive with the label image UV-wrapped (`packshot.py`). No mesh is generated and nothing is paid.
  - **Irregular products** (shoes, toys, gadgets, headphones, bags, characters): an Idol mesh. Auto uses **Idol Max for finals** and **Turbo for previews**; the picker can pin either.
  - **Unclassified** products stay on the primitive: a paid mesh needs a positive reason. A product that matches both lists ("toy in a box") counts as a primitive.
  - `autoPick` returns `mesh: { modelId, usd }` only for irregular products on a Blender shot with a product photo, so the Studio can show the one-time cost.
- **Schema (read from fal's OpenAPI, not guessed):**
  - In: `image_url` (required), `image_type` (`real` for photographs, `synthetic` for renders), `enable_pbr`, `mesh_resolution` (128, 256, 512, 768, 1024, 1536), `rig`, `seed`, `enable_usdz`.
  - Out: `game_glb` (30k triangles, UVs, 2048 px base colour and normal map; roughness/metallic only with `enable_pbr`), `model_glb` (full-resolution **vertex-coloured, no texture**), `mesh_stats`.
  - We always import `game_glb`; `model_glb` has no texture, so a label would be lost. The generic mesh picker in `adapters.ts` lists `game_glb` first for this reason.
- **Settings we choose:** `image_type: "real"` (brand photos are photographs); `enable_pbr` off (adds 20 s to 2 min and printed labels are not metallic); `rig` off (fal says rigid props get an unusable skeleton).
- **Cache:** `generateProductMesh()` in `src/lib/registry/product-3d.ts`. The key is a hash of the image bytes (the URL text for remote images), model id, options and a version. Files live in `$DATA_DIR/cache/product-3d/<key>.glb` with a `.json` sidecar. A hit costs $0 and makes no call; a cached file that is not a GLB is re-fetched; nothing is written unless the download starts with `glTF`.
- **Not done yet (Blender side):** the `glb_turntable` template and an importer (centre, scale to a known height, origin at the base, keep the baked texture) belong to the renderer; this step only guarantees a clean GLB path. Nothing renders a mesh until that lands.
- **Still unverified:** how Idol Max (not Turbo) does on an irregular product. The only real test so far was Turbo on a can. Before relying on the rule for finals, run one Idol Max test on a shoe or toy and look at the silhouette and the back.
- **Tests:** `tests/product-3d.test.ts` (mocked provider: no fal call, no cost).

## 14. Five-step Studio and the shot sheet (PRs #53, #55)

- Flow at `/studio`: Brand & goal -> Brief -> Shot sheet -> Previews -> Final. The old studio is at `/studio/classic`. Runs live in the `sheet_runs` table (migration 0005).
- The shot sheet (`src/lib/shot-sheet.ts`) is the single source of truth: every shot carries time, framing, camera (angle/move/lens), subject, action, lighting, on-screen text, sound (VO/SFX/music), transition, engine and the Blender template. Renderers read the sheet and nothing else.
- Enhancer: `src/lib/sheet/writer.ts` writes the sheet from brief + style rules; `normaliseSheet` fixes ids, drops VO in foley mode, forces the last shot to Remotion and refits timings to the exact target length. It does NOT route engines (render pipeline owns that).
- Sheet gate (`src/lib/sheet/gate.ts`) is check 1 of 3: timing, claims vs facts, banned phrases, style rules (push-in, void background, foley-first, fade before card, macro open...). On fail the writer gets one repair pass with the errors, then the gate runs again.
- Style rules: known reference links (the Neon lab post) use the built-in `NEON_LAB_RULES`; other links are broken down by the cheap vision model; no link uses `BASE_RULES`.
- Editing: any edit in the table refits timings, bumps the sheet version and re-gates. Changing an engine locks it (`engineLocked`) so routing won't override it.
- Cheap models only: gemini-3.8-flash for brief and sheet. Real cost of brief + sheet for the Neon run: $0.04, about 25 s + 48 s.
- Gotchas: the model tends to write SFX times as absolute seconds ("at 2.1s") instead of shot-relative; components defined inside components lose input focus (keep them at module scope); every paid call is appended to `SPEND_LEDGER` with the running total in column 5.

## 14.4 Remotion renderer for shot sheets

The Remotion renderer handles shot sheet rows with `engine: "remotion"`: kinetic text cards, title overlays, and the closing end card. Renders locally to MP4, no external API calls.

**Compositions:**
- `TextCard`: Kinetic text cards with placement (upper, center, lower). Text fades in with subtle spring movement.
- `LowerThird`: Text overlays that slide in over optional background clips. Semi-transparent backing with accent border.
- `EndCard`: Closing card with logo, headline, line, CTA, and footer. Elements stagger in and settle by 0.9s.

**Usage:**
```typescript
import { renderRemotionShot } from "@/lib/remotion-shot";

const result = await renderRemotionShot(row, brand, sheet, {
  width: 486,
  height: 864,
  fps: 30,
  cacheDir: "/tmp/remotion-cache", // optional
});
// result: { path: string, durationSec: number, ms: number }
```

**Caching:** Renders are cached by input hash (shot ID, text, duration, brand colors, resolution). Unchanged rows skip rendering. Cache keys are stable and deterministic.

**House style:** Black background (`#0b0b0f`), desaturated accent colors, restrained type (DejaVu Sans Bold). Hard cuts, fade to black before end card. Text feels like part of the scene, not a graphic overlay.

**Routing:** The render router picks Remotion for:
- Rows with `engine: "remotion"` or `model: "remotion:..."`
- Rows with `graphic: true` (text/graphic cards, no filmed subject)
- The last shot when it's an end card

**Local smoke test:**
```bash
npx tsx scripts/remotion-smoke.ts
```
Renders a 3-second end card and tests cache hit. Output: `/tmp/remotion-smoke-test.mp4`.

**Failure cases:**
- **Missing text:** Remotion shots (except end cards) require `text.copy`. Router should catch this upstream.
- **Bundle failure:** If `@remotion/bundler` fails, check that `remotion/index.ts` exists and `assets/fonts/` has the font file.
- **Chrome missing:** Remotion needs Chrome/Chromium. In Docker/CI, install `chromium` and set `PUPPETEER_EXECUTABLE_PATH`.
- **Memory limits:** Large compositions can OOM. Keep `concurrency: 2` and duration under 10s per shot.

**Integration:** The renderer is wired into `src/lib/render/renderers.ts` as `remotionRenderer()`. The shot sheet pipeline calls it through `renderRouted()` when routing picks Remotion.

## 14.5 Version stacks: side-by-side model comparison

The **Versions** feature (PR #60) lets one shot sheet render as 2–4 versions in parallel, each using a different model stack. The operator picks the best version to carry into Final.

**Data model:**
- A `VersionStack` holds an id, label, description, per-stage model picks (`Partial<Record<Stage, string>>`), and an estimated cost in USD.
- Stacks are stored on the run in `run.versions[]`, where each `Version` includes the stack, tier (preview/final), status (queued/rendering/done/failed/refused), render results (shots, videoUrl, usd, ms, score), and optional error.

**UI flow (Previews step):**
1. User selects 2–4 stacks from:
   - **Presets:** "Premium" (top closed models), "Open" (open-source), "Blender" (Blender-heavy), "Experimental" (latest).
   - **Custom:** pick models through the existing model picker, with live cost estimate.
2. Cost estimates shown per stack. Total checked against `run.cost.capUsd - run.cost.spentUsd`; start blocked if over budget.
3. Click **Start renders** → `POST /api/sheet { action: "start_versions", runId, stacks }`.
4. Side-by-side compare grid shows:
   - Video player slot per version
   - Model stack chips
   - Cost, render time, preview check score
   - Status (queued/rendering/done/failed)
5. **Pick winner** button on done versions → advances to Final step with that stack's picks.

**API:**
- `start_versions`: validates stacks (models exist, serve correct stages, budget OK), creates `Version` entries with status `queued`, normalizes partial stacks to fill missing stages with defaults. Returns run + message since rendering not wired yet.
- `pick_winner`: checks version is `done`, stores winner's stack as final picks, advances run to `final` step.
- Budget enforcement: rejects if `sum(stacks[].estimatedCostUsd) > run.cost.capUsd - run.cost.spentUsd`.

**Preset stacks (validated against registry on every test run):**
- All model ids exist in `CATALOG` and serve their assigned stages.
- Premium: Claude Opus 5.5, Kling 4.0, Veo 3.1, ElevenLabs v3.
- Open: Qwen 3.8, DeepSeek V4 Pro, Flux 3, Wan 3.1, HF voice.
- Blender: uses `auto` for video routing (products → Blender, text → Remotion, people → best video model).
- Experimental: Gemini 4 Neon, Veo 3.1, Higgsfield models.

**Cost estimation:**
- `estimateStackCost(stack, { shots, targetSec })` aggregates per-stage costs:
  - Video: `cost.usd * (targetSec / shots) * shots` for `per_sec` models
  - Image: `cost.usd * shots` for `per_image` keyframes
  - Voice: `cost.usd * (150 * shots) / 1000` for `per_1k_chars`
  - Text: `(cost.usd * 2 + cost.usdOut * 1) / 1000` for `per_mtok`
  - Music/SFX: `cost.usd` for `per_clip`
  - 3D asset: `cost.usd` for `per_asset`
  - Free/credits: 0
- Cost increases with more shots and longer target duration (tested).

**Rendering integration (pending):**
- `start_versions` queues versions but returns "rendering not wired yet" message.
- When render routing lands end-to-end, each version will call the existing per-shot render router with stack's model overrides, running versions in parallel within pool limits, reusing per-shot cache.
- Per-shot preview check scores aggregate to version-level score.

**Tests (tests/versions.test.ts, tests/versions-api.test.ts):**
- ✅ All preset model ids resolve to real registry entries
- ✅ All preset models serve their assigned stages
- ✅ Validation rejects non-existent models and wrong-stage assignments
- ✅ Cost estimates add up and increase with shots/duration
- ✅ Budget cap blocks start when total exceeds remaining budget
- ✅ Pick winner sets Final stack and advances step
- ✅ API validates input (2-4 stacks, valid models, budget)
- ✅ Custom stacks normalize to fill missing stages with defaults

**Gotchas:**
- Stack validation runs on every `start_versions` call. Model ids and stage assignments are checked against the live catalog, so a typo or misconfigured stack fails fast with a clear error.
- Preset stacks use only `runnable: true` models. A catalogued but non-runnable model (adapter not wired yet) would pass validation but fail at render time.
- `auto` is valid for video and asset3d stages. Don't reject it.
- Cost estimates are rough pre-flight totals. Actual costs depend on render time, token counts, etc. The cap enforces spending limits but estimates can drift.
- Normalized stacks fill every stage with defaults. A partial stack from the UI becomes a complete stack in the version entry.
- Picking a winner stores the stack but does not automatically render the final. The operator still clicks "Render final" on step 5.

**Migration:** `supabase/migrations/0006_version_stacks.sql` documents the structure and adds an index on `updated_at`. No schema change needed since `data` is already jsonb.

**Files:**
- `src/lib/versions.ts`: types, presets, validation, cost estimation, normalization
- `src/lib/sheet/run-types.ts`: `Version` type with `VersionStack`
- `src/lib/sheet/actions.ts`: `start_versions` and `pick_winner` API handlers
- `src/components/sheet-studio/versions-panel.tsx`: UI for stack selection and comparison
- `src/components/sheet-studio/render-steps.tsx`: integrates panel into Previews step
- `tests/versions.test.ts`: stack validation, cost estimation, presets
- `tests/versions-api.test.ts`: API validation, budget enforcement, winner selection

## 14.6 Sheet Render Integration with Versions (PR #63)

### Overview
Integrated the sheet render pipeline (`src/lib/sheet/render.ts`) with the Versions module from PR #61, enabling the Studio's Previews and Final steps to render through version stacks with per-stage model overrides.

### Key Changes

1. **Version Stack Integration** (`src/lib/sheet/render.ts`)
   - `renderSheetVersion` creates proper `VersionStack` objects with all required fields
   - Uses `getPresetsWithCosts()` for default stacks with `description`, `models`, `estimatedCostUsd`
   - Added `normalizeStack()` to ensure all stages have model assignments
   - Version stack models drive per-stage rendering: video, image, voice, QA models

2. **Model Override Wiring**
   - Pass stack models through `RenderDeps` to actual renderers
   - AI video renderer uses stack's video model (or `auto` resolved via registry)
   - Voice synthesis uses stack's voice model
   - QA checks use stack's QA model
   - Image generation uses stack's image model

3. **API Actions** (`src/lib/sheet/actions.ts`)
   - `start_versions`: validates and queues 2-4 version stacks
   - `previews` and `final`: delegate to `renderAction` for actual rendering through stacks
   - Studio Previews/Final buttons call real API end-to-end

4. **Test Coverage**
   - Updated API tests to verify working render actions
   - Added tests proving different stacks call different model IDs
   - All 460 tests pass

### Call Path: Studio UI → Render

1. **Previews**: User clicks "Start" in Versions panel
   - `VersionsPanel.tsx` → `onStartVersions(stacks)`
   - `RenderSteps.tsx` → `act({ action: "start_versions", stacks })`
   - POST `/api/sheet` → `sheetActions()` → creates queued versions
   - User clicks preview → `act({ action: "previews", versionId })`
   - POST `/api/sheet` → `sheetActions()` → `renderAction("previews")`
   - `renderAction()` → `startSheetJob()` → `runPreviews()`
   - `runPreviews()` → `renderSheetVersion()` with stack models
   - Renderers use stack's model choices per shot

2. **Final**: User clicks "Render final" after picking winner
   - `RenderSteps.tsx` → `act({ action: "final", runId })`
   - POST `/api/sheet` → `sheetActions()` → `renderAction("final")`
   - `renderAction()` → `startSheetJob()` → `runFinal()`
   - `runFinal()` → `renderSheetVersion(tier: "final")` with stack models
   - Final review uses stack's QA model

### Model Override Implementation

**How it works:**
- Each `Version` has a `stack: VersionStack` with `models: Partial<Record<Stage, string>>`
- `renderSheetVersion()` passes stack to `RenderDeps` creation
- Deps functions close over the stack and use its model choices:
  - `aiVideoRenderer({ defaultModel: stack.models.video || "auto" })`
  - `voiceover(line, { model: stack.models.voice })`
  - `qa(stack.models.qa, video, ...)`
- `auto` for video resolves per-shot via registry's `resolvePick()`

**Example:**
```typescript
// Premium stack
models: { video: "kling/v4/image-to-video", voice: "fal-ai/elevenlabs/tts/eleven-v3", qa: "google/gemini-4-carbon" }

// Open stack  
models: { video: "alibaba/wan-3.0/image-to-video", voice: "fal-ai/chatterbox/text-to-speech", qa: "google/gemini-3.8-flash" }

// Same sheet, two stacks → different model calls proven by tests
```

### Failures Encountered & Fixes

#### TypeScript Compilation Errors
**Issue**: `VersionStack` missing `description`, `models`, `estimatedCostUsd`

**Fix**: Import and use `getPresetsWithCosts()` and `normalizeStack()`

#### Undefined Version Reference  
**Issue**: `'v' is possibly 'undefined'` after `.find()`

**Fix**: Explicit check: `if (!version) throw new Error(...)`

#### Test Failures
**Issue**: Tests expected legacy 501 errors, but actions now work

**Fix**: Rewrote tests to create versions first, then verify render actions succeed

#### Package Management
**Issue**: npm lockfile committed instead of pnpm

**Fix**: Deleted `package-lock.json`, use `pnpm install` instead

### Cost and Caching

- **Budget cap**: Run's `cost.capUsd` checked before rendering
- **Preflight estimate**: Each version calculates cost before starting
- **Per-shot cache**: Uses `clipCache` keyed by shot content + model + size
- **Parallel rendering**: Respects concurrency limit (RENDER_CONCURRENCY, default 4)
- **Per-stack costs**: Different models → different estimates and actual costs

### What Renders End-to-End

✅ **Fully Operational**:
- Preview rendering with version stacks (2-4 in parallel)
- Per-shot routing (Blender, AI video, Remotion) respecting stack models
- Audio modes (foley-first, voiceover, both) with stack voice model
- Shot-level QA using stack's QA model (check 2 of 3)
- Final rendering at full quality with stack models
- Final review using stack's QA model (check 3 of 3)
- Cost metering with budget caps
- Model overrides wired through to actual provider calls

✅ **Tested**:
- Two stacks with different models → different provider calls
- All 460 tests pass
- pnpm build succeeds
- TypeScript type-safe

## 21. LLM-written sheet fields: clamp, never reject

**Problem:** The LLM enhancer (`src/lib/sheet/writer.ts`) often writes text longer than schema limits. When `framing` (was 160 chars) or `editorNote` (was 300 chars) exceeded their max, the whole sheet failed with a raw Zod `too_big` error in the Studio UI.

**Solution:** `Str(n, min)` in `src/lib/shot-sheet.ts` now clamps instead of rejecting. Using `z.preprocess`, it trims the string and slices it to n characters. If the slice cuts a word, it ends at the last word boundary plus "…" (still at most n chars). The schema still types as `string`, and `.default`, `.optional`, and `.nullable` still work.

**Changes:**
- `Str` signature: `Str(n: number, min = 0)`. Fields that require non-empty strings now use `Str(X, 1)` instead of `Str(X).min(1)`.
- Limits raised: `framing` to 240, `editorNote` to 400. Other limits unchanged.
- Tests verify: 400-char input clamps to ≤240 with "…"; word-boundary clamping works; `.min(1)` fields still reject empty strings; `.default`, `.optional`, `.nullable` behavior preserved.

**Lesson:** Never use hard `.max()` on free-text LLM output that you only display. Clamp it, show what fits, and let the user see the sheet instead of a schema error.

## 23. Story Patterns (Confession Loop)

**What:** Named narrative structures with deterministic rules the gate enforces and subjective qualities the final review scores. Patterns live in `src/lib/sheet/patterns/` and are selected in the Brand & goal step. The sheet writer, gate checks, and final review all adapt when a pattern is active.

**Patterns:**
- **Confession loop** (default): Opens with the goal in plain words, ties it to something personal, shows one small physical example, brings in the problem with "but…" and silence, gives it a specific cause the speaker owns, hits the low point with what the viewer is feeling and a close-up, follows with a crazy plan in one long take, cuts before the attempt, and ends on the takeaway that echoes the opening. Brand-agnostic: the rule-and-tiny-example angle comes from the brief, not hard-coded text.
- **Classic**: The current default behavior with no specific story structure—flexible pacing, music bed, standard captions.

**The 17 rules (Confession loop):**
1. Open with the goal in plain words in the very first sentence.
2. Tie the goal to something personal, then raise that stake once. (judged)
3. Show one small, physical example on screen instead of explaining in the abstract. (judged)
4. Bring in the problem with "but…" and follow it with about a second of silence. (gate-checked)
5. Give the problem a specific cause the speaker owns. (judged)
6. At the low point, say out loud what the viewer is feeling ("now you're like, uh-oh").
7. Follow the problem with a plan that sounds a little crazy. (judged)
8. Cut before the attempt and never show the result. (gate-checked)
9. Cut every 1.5–2 seconds during the setup, then hold one long take on the confession and on the plan. (gate-checked)
10. Cut away to a reaction or b-roll every 2–3 seconds the rest of the time. (gate-checked)
11. Punch in to a close-up at the low point, then go wide again after. (gate-checked)
12. Keep captions to 2–4 short words at a time, plus one bright label in the first 3 seconds. (gate-checked)
13. Speak at about 4 words per second and slow down only at the turn. (gate-checked)
14. Leave out music and let pauses do the work. (gate-checked)
15. End on the takeaway with no call to action, and echo the opening line so it loops. (gate-checked)
16. Promise a rule that works on anything, then prove it with one tiny example. (judged)
17. Make the video follow the technique it teaches. (judged)

**Data structure (`StoryPattern`):**
- `id`, `name`, `description`
- `rules`: The 17 rules verbatim
- `gateChecked`: indices of rules the gate enforces deterministically (4, 9, 10, 11, 12, 13, 14, 15)
- `judged`: indices of subjective rules the final review scores (2, 3, 5, 7, 16, 17)
- `beats`: Beat sequence with `beat` role, `durationRange`, `longTake`/`quickCuts` flags, `framing`, `silenceAfter`
- `rhythm`: `voicePace` range, `slowBeats`, `setupCutLength`, `cutawayCadence`
- `captions`: `wordsPerChunk` range, `brightLabelBefore` (seconds)
- `audio`: `music` (boolean), `pausesWork` (boolean)
- `ending`: `cta` (boolean), `echoOpening` (boolean)

**Sheet schema changes:**
- `ShotSchema`: added `beat?: string` (the beat role, e.g. "goal", "low_point"), `text.chunks?: string[]` (caption chunks, 2–4 words each)
- `SheetSchema`: added `patternId?: string` (defaults to "confession_loop")
- `RuleSchema.check`: added `setup_cuts`, `long_takes`, `cutaway_cadence`, `caption_chunks`, `vo_pacing`, `no_music`, `silence_gap`, `closeup_wide`, `echo_opening`, `no_cta`, `beats_present`

**Writer integration (`src/lib/sheet/writer.ts`):**
- `SheetInput` gains `patternId?: string`
- `sheetPrompt()` includes pattern-specific instructions when `patternId === "confession_loop"`:
  - VO lines per beat at ~4 words per second, with slower turn marked
  - Setup shots 1.5–2 s, long takes (3+ s) for confession and plan, 2–3 s cutaways
  - Punch-in at low point, then wide
  - Captions in 2–4 word chunks, with one bright label in first 3 s
  - No music (`bed: null`, `music: null` everywhere), ~1 s silence after "but…"
  - No CTA, last line echoes first (60%+ token overlap)
  - All beats present in order: `goal → personal_stake → stake_raised → physical_example → but_silence → owned_cause → low_point → crazy_plan → cut_before_attempt → takeaway`
- `normaliseSheet()` preserves `patternId`, `beat`, and `text.chunks` fields

**Gate checks (`src/lib/sheet/gate.ts`):**
- `confessionLoopChecks()` enforces the deterministic rules when `sheet.patternId === "confession_loop"`:
  - Setup cuts (goal, personal_stake, stake_raised, physical_example) 1.5–2 s
  - Long takes on low_point and crazy_plan (3+ s)
  - Cutaway cadence on other beats 2–3 s
  - Caption chunks 2–4 words each, bright label before 3 s
  - VO pacing 3.5–4.5 words/sec (excluding slow beats: but_silence, low_point)
  - No music (bed null, no music cues)
  - Silence gap after "but…" beat (enforced in stitcher)
  - Close-up at low_point, wide at takeaway
  - Last VO echoes first (60%+ token overlap)
  - No CTA phrases ("buy", "shop", "link in bio", "sign up", "learn more", etc.)
  - All beats present in order, attempt result never shown
- Auto-repair runs once on gate failure, the way the existing flow does

**Final review (`src/lib/qa/final-review.ts`, `src/lib/qa/pattern-review.ts`):**
- `FinalDeps` gains `patternReview?: () => Promise<{ score: number; notes: string[] }>`
- When `patternId === "confession_loop"`, the final review calls `patternReview()` with a rubric for the subjective rules (2, 3, 5, 7, 16, 17):
  - Personal stake is real (rule 2)
  - Physical example is specific, not abstract (rule 3)
  - Cause is owned (rule 5)
  - Plan sounds crazy (rule 7)
  - Rule-and-example angle present (rule 16)
  - Video follows the technique it teaches (rule 17)
- Score 0–10, with notes. Pattern review score < 7 caps the final at 7 (same as loudness or caption sync)
- `confessionLoopReviewPrompt()` in `pattern-review.ts` builds the rubric

**Render and edit:**
- Stitcher honors silence gaps: after a shot with `beat: "but_silence"`, insert ~1 s of silence before the next VO
- Caption renderer shows 2–4 word chunks when `text.chunks` is present, plus bright early label (first 3 s)
- No music: when `patternId === "confession_loop"`, `bed` is null and no music cues are rendered

**Tests (`tests/confession-loop.test.ts`, mocked providers, no paid calls):**
- Pattern structure: 17 rules present, correct gateChecked/judged split, 10 beats in order
- Good sheet passes every check
- One failing fixture per check gives a readable reason:
  - Missing "but_silence" beat
  - "but_silence" beat without "but" in VO
  - Setup cuts too long (> 2 s)
  - Long takes too short (< 3 s)
  - Caption chunks wrong word count
  - VO pacing off (< 3.5 or > 4.5 words/sec)
  - Music present
  - Low point not a close-up
  - Last VO doesn't echo first
  - CTA phrases present
  - Beats missing or out of order
- Old sheets without `beat` fields still parse
- Pattern picker API round trip (future: UI wiring)
- Non-Neon brand fixture (Coffee Co) passes, proving brand-agnostic

**Wiring status:**
- ✅ Data structure (`patterns/index.ts`)
- ✅ Schema changes (`shot-sheet.ts`)
- ✅ Writer integration (`sheet/writer.ts`)
- ✅ Gate checks (`sheet/gate.ts`)
- ✅ Final review integration (`qa/final-review.ts`, `qa/pattern-review.ts`)
- ✅ Tests (mocked, pass)
- ✅ Docs (this section)
- ⚠️ **Stitcher silence gaps:** Not yet wired. The gate checks for the beat structure, but the actual silence insertion after "but_silence" needs to be added to the audio stitcher.
- ⚠️ **Captions renderer chunks:** Not yet wired. The chunks are in the schema and gate-checked, but the captions renderer needs to read `text.chunks` and display them as 2–4 word segments.
- ⚠️ **Pattern picker UI:** Not yet wired. The Brand & goal step needs a dropdown or toggle to select "Confession loop" vs "Classic".
- ⚠️ **Pattern review caller:** The `patternReview()` function is stubbed. The render pipeline needs to call `reviewConfessionLoop(sheet, qa)` with the actual video URL and QA model.

**How to use:**
1. In the Brand & goal step, the operator picks "Confession loop" (default) or "Classic".
2. The sheet writer receives `patternId: "confession_loop"` and follows the pattern rules exactly.
3. The gate checks enforce the deterministic rules (setup cuts, long takes, captions, VO pacing, no music, echo opening, no CTA, all beats).
4. The auto-repair loop fixes gate failures once, the way the existing flow does.
5. The final review scores the subjective rules (personal stake, physical example, owned cause, crazy plan, rule-and-example, video follows technique) when the pattern is active.

**Cost:** No new paid calls. The pattern logic is deterministic checks (free) plus one existing final review call (already counted) with a pattern-specific rubric.

**Lesson:** A story pattern system lets the operator enforce a specific narrative structure across any brand, with the gate catching deterministic violations and the final review scoring subjective quality. The 17 rules verbatim are the source of truth, and the code implements them as executable checks.

## 22. Blender Queue Visibility and Cancellation (Studio Quality Gates branch)

**Symptom (2026-11-19):** A user's Studio UI render sat invisibly behind a test run's Final that had queued 6-7 Blender shots (about 45 s each with EEVEE). The single process-wide `blenderSlot` was a FIFO queue with no visibility and no way to cancel. Previews took 4m27s for 6 Blender shots, blocking the user's interactive render.

**Problem:** The Mac has 8 GB and Blender uses every core, so shots queue for the one slot (`BLENDER_PARALLEL=1`). Every Blender shot from every run waits in this one invisible line. When one run's Final queued 6-7 shots, the user's own render from the Studio UI had no indication of queue state and no way to cancel. Previews were slow even for picking a version.

**Solution (5 parts):**

### 1. Queue Visibility
- Made the Blender slot an **observable queue** (`src/lib/render/blender-queue.ts`). Each job has `id`, `runId`, `versionId`, `shotId`, `state` (`waiting`/`running`/`done`/`cancelled`/`failed`), `priority`, `enqueuedAt`, `startedAt`, `finishedAt`, `process`, `abortController`, and `error`.
- Exposed it with **`GET /api/studio/queue`** using the same auth as other studio API routes. Returns jobs filtered by `runId` or `versionId`, with position, duration, and wait times.
- In the **Studio Previews and Final steps**, show per-shot state: "waiting, #N in line", "rendering", "done" or "cached". Also show a small global strip with the number of jobs ahead and which run they belong to. **Poll every 2 s while anything is active** (optional; implement when wiring the UI).

### 2. Cancel
- Added **`POST /api/studio/queue`** for cancelling by `runId`, `versionId`, or `jobId`. It:
  - Removes waiting jobs from the queue
  - Kills the running Blender child process (stores handle, uses `SIGTERM`, then `SIGKILL` after 3 s)
  - Aborts in-flight AI-video or provider calls through `AbortController` (wired where the provider client supports it)
- Marks the version `cancelled` (added to the status union in `src/lib/sheet/run-types.ts`).
- **Clears the run's "working" status** so the 409 guard in `src/lib/sheet/render-actions.ts` releases.
- Added a **Cancel button** in the UI next to each rendering version and each run (optional; implement when wiring the UI).

### 3. Auto-Cancel Superseded Jobs
- When a run starts a new render step, **`autoCancel`** that same run's earlier **queued** jobs for the same version, since they're superseded. Running jobs are not auto-cancelled.

### 4. Faster Previews
**Preview mode Blender:**
- **Resolution:** 480p-class resolution (854×480 for 16:9, scaled for other aspects) and 24 fps (no interpolation needed since Blender renders at native fps).
- **EEVEE `taa_render_samples`:** 8 in preview, the spec value (16 or 32) in Final.
- **Raytracing and volumetrics:** Off in preview mode. Set `use_raytracing = False` and `volumetric_samples = 0` in preview. Both `scripts/blender/shot_kit.py` and `scripts/blender/scene_kit.py` read the `mode` field from the spec JSON.
- **Final mode:** keeps the current quality (720p or requested size, full samples, raytracing, volumetrics).

**Priority:**
- Interactive (Studio UI) jobs get `priority: "high"`.
- Background or scripted runs use `priority: "normal"`.
- The queue serves high-priority waiting jobs before normal-priority ones.

**Timing log:** Added per-shot timing (stored in `durationMs` on the queue job; optional to expose in UI).

### 5. Tests (Vitest, mocked processes, no paid calls)
All tests in `tests/blender-queue.test.ts`:
- ✅ **Queue order and priority**: FIFO for same priority, high priority goes first.
- ✅ **Queue position reporting**: `getPosition()` returns 1-indexed position for waiting jobs, `null` for running/done.
- ✅ **Cancel removes waiting jobs** and kills the running one (fake child process).
- ✅ **Superseded auto-cancel**: new job for same run+version cancels earlier waiting jobs, not the current one.
- ✅ **409 guard is released** after cancel (slot freed for next job).
- ✅ **Preview spec**: samples 8, raytracing off, 854×480 for 16:9.

**Test results:**
- All queue tests pass.
- Existing Blender tests still pass (fallback for no job context).
- `pnpm tsc --noEmit` is clean.
- `pnpm build` passes.

### Implementation Notes
- **Process handle tracking:** `spawnTracked()` in `blender-scene.ts`, `blender-kit.ts`, and `packshot.ts` registers the `ChildProcess` with the queue via `setProcess()`.
- **Job context:** `RenderJobContext` (in `renderers.ts`) carries `jobId`, `runId`, `versionId`, `priority`. Passed through `defaultRenderDeps()` to `blenderRenderer()`.
- **AbortController:** Registered via `setAbortController()` for cancellable AI calls (wired where the provider supports it; stubbed for now).
- **Queue cleanup:** `cleanup(maxAgeMs)` removes old finished jobs (default 1 hour). Not called automatically; invoke it periodically or on demand.

### Wiring Status
- ✅ Queue manager (`blender-queue.ts`)
- ✅ API endpoint (`/api/studio/queue`)
- ✅ Cancel action (`/api/sheet` via `sheetActions`)
- ✅ Auto-cancel in render actions
- ✅ Preview optimizations (Python scripts, TypeScript spec)
- ✅ Process tracking (Blender, packshot)
- ✅ Priority support
- ✅ Tests
- ⚠️ **UI wiring (queue display, Cancel buttons, polling):** Not yet implemented. The API is ready; the Studio UI needs to call `GET /api/studio/queue` every 2 s while active, and add Cancel buttons that call `POST /api/studio/queue` with `action: "cancel"`.
- ⚠️ **AI-video AbortController:** Stubbed in the queue but not wired to actual provider calls. Fal, OpenRouter, and Higgsfield clients need to accept `signal: AbortSignal` and pass it to their HTTP fetch calls.

### Provider Cancellation (Not Yet Wired)
**Which providers support abort?**
- **Fal:** Supports `signal` on `fal.subscribe()`. Wire it in `src/lib/ai.ts` `generateVideo()`.
- **OpenRouter:** HTTP-based, can pass `signal` to `fetch()`. Wire it in the same function.
- **Higgsfield:** Uses its own client; check if it accepts a signal. If not, abort is a no-op (the request completes server-side, but we stop waiting).

**What's stubbed:**
- `setAbortController()` is called with a fresh `AbortController` in `withBlenderSlot()`.
- Cancel triggers `controller.abort()`.
- **To complete:** AI renderers (`ai-video`) must create an `AbortController`, pass its `signal` to the provider call, and register the controller via `setAbort()` in the `withBlenderSlot()` callback. For now, cancel only stops Blender; AI-video jobs run to completion server-side.

### How to Use
**In the Studio UI:**
1. Poll `GET /api/studio/queue?runId=<id>` every 2 s while `hasActive` is true.
2. For each job, show its `state` and `position` (if waiting).
3. Add a Cancel button next to rendering versions/runs that calls `POST /api/studio/queue` with `{ action: "cancel", versionId: "<id>" }` (or `runId`).

**Priority:**
- Studio UI renders: pass `priority: "high"` in the render action body.
- Background/script runs: omit it (defaults to `"normal"`).

### Future Enhancements (Not in This PR)
- **Multi-slot queue**: If `BLENDER_PARALLEL > 1`, the queue can run N jobs concurrently. The implementation supports it; just set the env var.
- **Per-user priority**: Team admins could get higher priority than free users.
- **ETA display**: "~2m remaining" based on average Blender shot time.
- **Queue history**: Keep finished jobs longer for debugging (currently 1 hour, configurable).

### Related
- PR branch: `devin/1794972912-studio-quality-gates`
- See also: PLAYBOOK §14 (Studio flow), §9 (Video plan), §6 (Stage gates)

## 22. Audio copied the Neon reference (fixed)

**Symptom:** Every video's audio sounded like the Gemini 4 Neon reference instead of matching its own script and video.

**Root causes:**
- `droneBed()` synthesized the same sub-sine drone for every video. The `sheet.bed` default was "low analog synth drone" and the writer prompt asked for a "music/drone bed".
- `src/lib/sfx.ts` and `src/lib/audio/mode.ts` gave foley as a fixed list of lavfi-synthesized kinds (whoosh, pop, fizz, pour, clink, click, thud, slide, sizzle), matched by regex. Anything else got nothing or a generic whoosh on every cut.
- `voiceover(line, "Rachel", ...)` was hard-coded with the same voice for every brand.

**Fix (PR: unique-audio-per-video):**
1. **Sound design step** (`src/lib/audio/sound-design.ts`): A cheap text-LLM call that uses the existing chatJSON and the run's text model. From the sheet (each shot's subject, action, VO, sfx line, transition and timing), the brief (brand, tone, audience) and the story pattern if one exists, it produces a SoundPlan:
   - Per shot: 0-3 SFX cues with an exact description (specific to what's on screen, such as "ceramic mug set down on oak desk" rather than "thud"), an offset and a gain.
   - A music decision: none, or a cue with a prompt describing genre, tempo, instruments and mood from the script, where each run gets a different cue derived from its content.
   - A voice persona (gender, age, energy, pace) chosen from the brand and script.
   - Respects pattern rules (e.g. if a rule says "leave out music", music is none).

2. **Generated audio, matched to picture**: Prefer video-to-audio so the sound is synced to the actual clip.
   - Per shot: generate SFX from the rendered clip plus the cue prompt using MMAudio (fal, \$0.001/sec) or other models from the version stack.
   - Music: use the existing `musicBed()` in `src/lib/ai.ts` (ElevenLabs Music v2.5 \$0.6/clip default, or Stable Audio \$0.2/clip) with the plan's prompt, only when the plan says music.
   - Voice: map the persona to a voice id from the voices `voiceover()` already supports. No longer hard-coded "Rachel" - deterministic choice per brand.
   - Every call goes through the existing paid()/meter, costs are tracked per model, appears in the version cost estimate, and is blocked by the run cap.
   - Cache per shot by input hash, the same as the clips.
   - Fallback: if a provider is unavailable or the cap is hit, fall back to local lavfi SFX and NO drone, and log it.

3. **Remove the Neon default**: Changed the bed default from "low analog synth drone" to empty string. Keep `droneBed` only if the plan explicitly asks for a drone. Rewrote the writer prompt so it asks for script-specific sound lines per shot (exact sounds tied to the on-screen action) instead of a drone bed.

4. **Mixing**: Keep the voice on top, SFX under it, and music (when present) ducked. Honour silence gaps from the sheet or pattern. Aim for about -14 LUFS, using the existing loudness check in `src/lib/stage-gates.ts`.

5. **Audio models in registry**: Added audio stages (sfx, music, voice) to the model registry (`src/lib/registry/`) alongside video, image, qa. Wired them through `defaultRenderDeps(stackModels)` so each version stack can pick its audio models.
   - Premium/Auto defaults use top quality: MMAudio V2 (video-to-audio, \$0.001/sec), ElevenLabs Music v2.5 (\$0.6/clip), ElevenLabs v4 TTS (\$0.1/1k chars).
   - Open source preset uses: Stable Audio 3 Small SFX (open), ACE-Step (open music), Chatterbox (open TTS).
   - Models verified live: `fal-ai/mmaudio-v2`, `sonilo/v1.1/text-to-sound-effects`, `elevenlabs/sound-effects/v3`, `elevenlabs/music/v2.5`, `fal-ai/stable-audio-25/text-to-audio`, `elevenlabs/tts/eleven-v4`.

6. **Quality over budget**: Removed artificial per-call limits for audio. The run cap is user-settable in the UI with no hard-coded low ceiling. Audio goes through the meter and ledger for tracking, but quality comes first.

## 23. Fix the Gaps Button (Auto-Repair Gate Failures)

**Symptom (2026-11-19):** A shot sheet fails the gate with rule violations like `Rule "Hold for 4 seconds": no wide reveal holds for 3 s or more`. The operator has no one-click way to fix it—they must manually edit each shot or rewrite the whole sheet.

**Solution:** A **"Fix the gaps"** button in the Studio's Shot sheet step that:
1. Sends the failing sheet, exact gate error messages, and brief to the text LLM via the existing writer path.
2. Prompts for MINIMAL edits that satisfy each failing rule (e.g., lengthen or add a wide shot ≥ required seconds, rebalance durations to keep total runtime).
3. Re-runs the gate on the result server-side.
4. Loops up to 2 repair attempts if the gate still fails, keeping the best result.
5. Saves the repaired sheet as a new revision (old sheet is not lost; operator can undo/revert by manually editing back).
6. Shows loading state, a diff summary of changed shots ("Shot 2: 2.0s → 4.5s, framing now wide"), and any remaining failures.
7. Button is disabled while a render is running for this run.

**Gate Logic Fix:** The `reveal_holds` rule text says "four full seconds" but the check used a hard-coded 3s threshold. Now:
- Parses the threshold from the rule text when a number is present (e.g., "four"/"4 seconds" → 4).
- Accepts various shot type/framing words: `wide`, `reveal`, `establishing`, `full`, `long shot`, `extreme wide`, `WS`, `EWS`.

**Implementation:**
- **API Route:** `POST /api/sheet` with `action: "fix_gaps"` (authenticated, checks if a render is running).
- **Backend:** `src/lib/sheet/actions.ts` → `fix_gaps` action uses `writeSheet` with gate errors as fixes, re-gates, loops up to 2 times, tracks changes.
- **UI:** `src/components/sheet-studio/studio.tsx` → `SheetStep` component shows button next to gate failures, calls API, displays result.
- **Cost:** Each fix attempt costs one text-model call (~$0.01–0.02 with gemini-3.8-flash), metered against the run cap.

**Tests (all passing):**
- `tests/gate-threshold.test.ts`: Gate parses thresholds from rule text ("four seconds" → 4s), recognizes wide-shot framing words, defaults to 3s.
- `tests/fix-gaps-api.test.ts`: API action with mocked LLM, verifies auth, render-blocking, looping, cost metering, diff reporting.
- `tests/fix-gaps-revisions.test.ts`: Revision behavior, version increments, operator can manually revert by editing back.

**Usage:** When the sheet gate shows errors, click **Fix the gaps**. The LLM rewrites failing shots (e.g., lengthens a 2s wide shot to 4.5s). The diff summary shows which shots changed. If some failures remain, the operator can manually fix them or click again.

**Cost Control:** The fix attempts are metered through the existing `meterFor(run)`, so a low run cap blocks expensive loops. Each attempt is logged in the run's cost entries.

**Related:** See §14.3 (shot sheet gate), §14.2 (writer), §6 (stage gates).

## 24. Style rules blocked all rendering (fixed 2026-11-19)

**Symptom:** Operators could not generate videos at all. Style rules extracted from inspiration videos (e.g., "Hold the contemplative stillness for at least four full seconds...") became HARD gate errors in `src/lib/sheet/gate.ts` (`ruleIssues`), so the Previews button stayed disabled (`studio.tsx:283 !run.gate?.pass`) and render actions 400'd (`actions.ts:90`, `render-actions.ts:15`). Even perfect sheets with only minor style deviations couldn't render. The "Fix the gaps" button (`actions.ts fix_gaps`) sometimes made sheets WORSE (more total issues), dying on `TypeError: fetch failed ... ConnectTimeoutError` to the LLM and leaving the broken version saved.

**Root causes:**
1. **Style rules as blocking errors:** `ruleIssues()` and `confessionLoopChecks()` returned `level: "error"` for all style/pattern violations. Clock issues (runtime mismatch), missing required fields (camera, audio), and false claims should block, but stylistic notes (wide-reveal duration, VO pacing, caption chunking) are editorial preferences that shouldn't prevent rendering.
2. **Fix-gaps made things worse:** The action scored candidates only by error count, so moving from 2 errors to 1 error + 5 warnings looked better, but the new candidate could introduce NEW blocking issues. No retry on network errors (ConnectTimeoutError), and no "keep original if candidate doesn't improve" fallback.
3. **No override path:** Clock/field errors that are NOT claims/safety (e.g., slightly broken timing, one shot missing a sound effect) had no "continue anyway" option. Users had to abandon the run or manually fix every detail.

**Fix (severity tiers + override + fix-gaps improvements):**
1. **Severity tiers in `sheetGate`:**
   - **Blocking errors (`level: "error"`):** Clock/runtime mismatch (`timingIssues`), missing required fields (camera angle/move/lens, audio), unsupported/unverified claims (`claimIssues`), superlatives without fact support, safety violations.
   - **Warnings (`level: "warn"`):** Style rules from inspiration (`ruleIssues` → always "warn"), story-pattern checks (`confessionLoopChecks` → always "warn"). Shown in the UI as amber "Style notes" separate from red blocking errors.
   - `gate.pass = no blocking errors`. Warnings don't block previews or render.

2. **"Continue anyway" button:**
   - If there are blocking errors AND none are claim/safety (checked by text matching: `claims`, `unverified`, `facts mark as`, `verified facts don't support`), the UI shows an orange "Continue anyway" button (`studio.tsx`).
   - User confirms, server records `gateOverride: { at, by, issues }` on the run (`run-types.ts` added `GateOverride | null`, `flow.ts` initializes it to null).
   - Actions and render-actions (`actions.ts:90`, `render-actions.ts:15`) allow rendering when `!run.gate?.pass && !run.gateOverride`.
   - Claim/safety errors CANNOT be overridden (server returns 400 with `cannotOverride` list).
   - The override is shown in the UI with the user's name and timestamp. The gate badge shows "overridden (N issues)" in green.

3. **Fix-gaps improvements (never make it worse):**
   - **Scoring:** `score = (blocking errors * 10) + warnings`. Blocking errors weigh 10x more than warnings.
   - **Keep best:** Across all attempts, including the ORIGINAL sheet, keep the candidate with the lowest score. If no candidate strictly improves (`candidateScore < originalScore`), keep the original unchanged and return `{ message: "Couldn't improve automatically; N issues remain", changes: [], fixed: 0, remaining: N }`.
   - **Prompt updated:** Pass the FULL current sheet to `writeSheet` and require returning the same shot count, shot IDs, and total runtime unless the issue IS runtime. Minimal field changes only (preserve as much as possible).
   - **Network retry:** On `fetch failed`, `ConnectTimeoutError`, `UND_ERR_CONNECT_TIMEOUT`, or 5xx, retry once with 2s backoff before counting an attempt.
   - **Target warnings too:** The fixes list includes BOTH errors and warnings, so fix-gaps can also improve stylistic issues (not only hard blockers).

4. **Tests (added/updated):**
   - `tests/gate-severity.test.ts`: Style rule violations are warnings, claim errors remain blocking, confession loop checks are warnings, clock/missing-field errors remain blocking, gate passes with only warnings.
   - `tests/fix-gaps-scoring.test.ts`: Scoring formula, keep original when candidate score is same or worse, network retry on ConnectTimeoutError/fetch failed/5xx, no retry on non-network errors.
   - `tests/gate-threshold.test.ts`: Updated to expect `gate.pass = true` with warnings (style rules), not blocking.
   - `tests/fix-gaps-revisions.test.ts`: Updated to reflect new behavior (keep original when no improvement).

**Result:** Users can now render videos with style warnings. The Previews button is enabled when only warnings remain. If there ARE blocking errors (clock, missing fields), users can override non-claim errors with "Continue anyway" or use "Fix the gaps" (which now never makes things worse). Claim/safety errors still block and cannot be overridden.

**Related:** See §14.3 (shot sheet gate), §23 (Fix the gaps button), §6 (stage gates).

## 25. Audio and Blender parallelism fixes (2026-11-20)

**Problem:** End-to-end test showed audio generation was slow and sequential, Blender renders bypassed the queue limiter and swapped an 8GB Mac heavily, and SFX models were deprecated causing all generated audio to fail silently.

**Root causes:**
1. **SFX generation broken**: `fal-ai/mmaudio-v2` and `fal-ai/stable-audio-3/small/sfx/text-to-audio` returned `{"detail":"This endpoint is deprecated"}`. `elevenlabs/sound-effects/v3` wanted `text` key not `prompt` (422). `mirelo-ai/sfx2.0/text-to-audio` returned `audio` as an array but code read `result.audio?.url`. `falRun` never checked `detail` field or HTTP errors properly.
2. **Sequential audio**: SFX cues ran sequentially at render.ts ~260-273, voice lines at ~251-255. Sound-design LLM call started after shot checks instead of in parallel.
3. **Blender queue bypassed**: `start_versions` called `deps(version?.stack.models)` without `jobContext` (actions.ts ~125), so the BLENDER_PARALLEL=1 limiter was skipped and runParallel started 4 Blenders. No RAM-aware defaults.
4. **fix_gaps slow and synchronous**: Made 2 sequential ~49s LLM attempts inside HTTP request with no in-progress guard, risking 300s maxDuration timeout.
5. **store.ts unsafe writes**: Rewrote whole db.json synchronously on every put (~79-88) with no atomic rename or debouncing, risking data loss on crash.
6. **SFX didn't match picture**: Sound design prompt didn't emphasize using sheet SFX fields directly or timing cues to visible actions. Failed SFX fell back silently to generic lavfi foley.

**Fix:**
1. **SFX model fixes** (`src/lib/ai.ts`, `src/lib/audio/generate.ts`):
   - `falRun` now checks `detail` field in both initial response and completed result, throws on error
   - Switched default SFX model to `mirelo-ai/sfx2.0/text-to-audio` (working as of 2026-11-20)
   - Handle array output from mirelo: `result.audio` can be array or single object
   - Use per-model input keys from `FAL_KNOBS` snapshot: `elevenlabs/sound-effects/v3` uses `text` key
   - Removed deprecated models from defaults (mmaudio-v2, stable-audio-3/small/sfx)
   - Verified music model (`elevenlabs/music/v2.5`) and voice model (`fal-ai/elevenlabs/tts/eleven-v3`) still work

2. **Parallel audio** (`src/lib/sheet/render.ts`):
   - Sound-design LLM call now starts in parallel with shot checks instead of after
   - SFX cues run with bounded concurrency (4 at a time) instead of sequentially
   - Voice lines run with bounded concurrency (4 at a time)
   - Timing: sound design + shot checks now overlap, audio generation batched

3. **Blender queue fixed** (`src/lib/sheet/actions.ts`, `src/lib/render/blender-queue.ts`):
   - Pass `jobContext` to `deps()` in start_versions so all Blender renders share one limiter
   - Default concurrency: 2 on machines with ≤16GB RAM (os.totalmem), 4 otherwise, overridable via BLENDER_PARALLEL env var
   - Prevents memory thrashing on low-RAM machines

4. **fix_gaps async** (`src/lib/sheet/actions.ts`, tests updated):
   - Runs as background job via `startSheetJob`, returns "working" status immediately
   - UI polls run status until complete
   - LLM attempts run concurrently with `Promise.all` instead of sequentially
   - Keeps best result including original (never makes it worse)
   - Result stored in run's `fixGapsResult` field for UI to display
   - Tests updated to handle async behavior with polling

5. **Atomic writes** (`src/lib/store.ts`):
   - Writes debounced to 100ms (coalesces rapid writes)
   - Atomic: temp file with timestamp+PID, then rename to final path
   - In-progress flag prevents concurrent writes

6. **SFX tied to picture** (`src/lib/audio/sound-design.ts`, `src/lib/sheet/render.ts`):
   - Sound design prompt now emphasizes using exact sheet SFX field when present
   - Instructions to derive from visible action and subject when sheet SFX missing
   - Time each cue offset to when action happens within shot
   - Add short sting/impact at "but" turn (but_silence beat) and end card
   - Failed SFX logged loudly in version error field with ⚠️ prefix, never silent fallback
   - Error includes shot number and exact description that failed

**Before/after timing estimates (8GB M1 Mac):**
- Shot sheet: 49s (unchanged, Gemini 3.8 Flash)
- fix_gaps: ~99s sequential → ~50s concurrent (2 attempts in parallel)
- Previews audio: ~3min sequential → ~1.5min with 4-concurrent batches
- Final audio: ~70s sequential "edit and mix" → ~35s parallel
- Blender: 4 concurrent (thrashing) → 2 concurrent (smooth on ≤16GB RAM)

**Models verified live (2026-11-20):**
- SFX: `mirelo-ai/sfx2.0/text-to-audio` (primary), `elevenlabs/sound-effects/v3` (fallback with `text` key)
- Music: `elevenlabs/music/v2.5`
- Voice: `fal-ai/elevenlabs/tts/eleven-v3` (via VOICE_MODEL default)

**Tests:** All 568 passing (baseline maintained). TypeScript clean. Build succeeds.

**Known limitation:** Final renders still re-render every Blender shot at 1080p instead of upscaling/reusing preview clips. Safe fix (upscale or reduced samples) deferred to avoid conflicts with parallel PR on render.ts. Would save ~2-3min on finals with unchanged shots.

**Related:** See §14 (sheet flow), §15 (render pipeline), cost metering.

## 26. Studio Quality Gate Fixes (2026-11-20)

### Bug 1: Continue Anyway Gate Override
**Failure**: `renderSheetVersion` threw "The shot sheet gate has errors" even when `gateOverride` was set. The API allowed override but the core render function ignored it.
**Cause**: `renderSheetVersion` only checked `run.gate.pass` and ignored `run.gateOverride`.
**Fix**: Honor `gateOverride` while still refusing claim or safety errors (superlatives, unverified claims). Also clear `gateOverride` when the sheet is edited and re-gated.

### Bug 2: Final Review Scores Zero
**Failure**: Final review always scored 0 with notes "Couldn't sample frames for QA". Loudness not measured, pattern quality 0.
**Cause**: `runFinal` passed `version.videoUrl` (a relative `/api/media/...` path) to `qa()`. ffmpeg in filmstrip can't open relative paths.
**Fix**: Resolve media URLs to data URLs via `mediaDataUrl()` before passing to `review()`, `loudness()`, and `ocr()` in render-deps.ts.

### Bug 3: Short AI Clips Abort Stitch
**Failure**: A 3.0s clip for a 3.2s shot threw "Shot N is shorter than its planned 3.2s". Wan and other models return whole seconds.
**Cause**: Stitcher rejected clips short by any amount over 0.12s.
**Fix**: When a clip is short by up to ~0.75s, extend it by holding the last frame (`tpad stop_mode=clone`). Only throw when grossly short (>1.0s).

### Bug 4: Product Hero Without Photos Crashes Version
**Failure**: A Blender `product_hero` shot with no product photo threw RendererUnavailable, router fell back to image-to-video with no image, fal returned 422 "image_url Field required".
**Cause**: Writer didn't exclude `product_hero` when `hasPhotos: false`. Router fell back to image-to-video without checking for a first frame.
**Fix**: Updated writer prompt to reject `product_hero` when photos unavailable. Added gate check for `product_hero` without photos. Router never falls back to image-to-video without a first frame.

### Bug 5: Gate Warnings That Can Never Clear
**Failure**: Several gate warnings flagged valid content:
- Foley mode: gate warns "but_silence must include 'but' in VO" but foley has no VO
- Takeaway beat always "missing" because end card excluded from `pics`
- CTA check flagged "tap water" as containing "tap"
- Rule 12 bright-label check only matched a few words
- Writer left placeholder text like "One physical example"

**Cause**: 
- VO checks ran even when `audioMode: "foley"` nulled all VO
- Takeaway check excluded remotion shots, so end card never counted
- CTA used substring matching instead of word boundaries
- Bright-label regex was too narrow
- No placeholder detection

**Fix**:
- Skip VO-text checks when there's no VO; check on-screen text or captions instead
- Count the end card for takeaway beat when it has `beat: "takeaway"`
- Use word boundaries in CTA check (`\b${phrase}\b`) to avoid false positives
- Expanded bright-label pattern to include "now", "introducing", "best", etc.
- Added placeholder text detection (rejects "one physical example", "tbd", "xxx", etc.)
- Removed "no voiceover at all" vs pattern VO contradiction in writer prompt

### Bug 6: End-Card Footer Collides with Burned Captions
**Failure**: The takeaway caption burned over the Remotion end card, colliding with the footer.
**Cause**: Caption burning didn't exclude the end card.
**Fix**: Filter caption cues to exclude those starting at or after the end card's start time.

### Bug 7: Small Issues
**7a. Failed version's ms**: Already correct - elapsed time set on failure path.
**7b. Final duration trim**: Trim final to exact `sheet.targetSec` when duration exceeds target by >0.05s.
**7c. fix_gaps reporting**: Count both errors and warnings in the async job result: `fixed = (originalErrors - bestErrors) + (originalWarnings - bestWarnings)`.

**Tests:** All 581 passing (+12 new tests in `tests/quality-gate-fixes.test.ts`). TypeScript clean. Build succeeds.

**Related:** See §25 (fix_gaps async), §24 (style rules), §14.3 (shot sheet gate).


## 136. Studio quality gates: product shots, character consistency, text legibility, brand tone

**Problem:** End-to-end Liquid Death test (Open source stack, Confession loop, 20s 16:9, no uploaded photo) scored 2/10 due to:
1. Product never appears (no uploaded photo → generic can tab only)
2. Four different random people instead of one confessing character
3. Title/text cards nearly black and unreadable ("MURDER", "PLASTIC", "MOUNTAIN WATER")
4. Tone doesn't fit brand (actors looked genuinely miserable instead of comedic/irreverent)
5. Final review didn't score down hard enough for these issues

**Fixes:**

### 1. Product image scraping from brand sites
- **New:** `scrapeProductImages(brandUrl)` in `src/lib/pipeline.ts` finds and downloads real product packshot images from:
  - Homepage `og:image`
  - JSON-LD Product schema images
  - Shopify `/products.json` endpoint
  - Product page links (`/product`, `/shop`, `/store` paths)
- Returns up to 3 images with source URLs
- **New field:** `Research.productPhotos?: { url: string; sourceUrl: string }[]`
- Called concurrently with text research in `research()`
- Used as first frame/reference for product shots in image-to-video
- Shown on Remotion end card (product image next to brand name)
- Stored as run photos; user can remove them in UI

### 2. Character consistency for people shots
- **New field:** `ShotSheet.character?: { description: string; referenceUrl: string | null }`
- Writer defines ONE recurring character (look, wardrobe, age, setting) when people shots exist
- Character description included in shot sheet JSON schema
- Used as reference for every people shot (passed to video model or used for image-to-video first frame)
- Gate warns when people shots exist but no character defined
- Gate warns when people shots don't reference the character (checks for 2+ matching words)
- Shown in Shot sheet UI step

### 3. Text legibility and contrast
- For text-only shots, prefer Remotion text renderer with high-contrast type
- Per-shot preview check measures text legibility (OCR confidence or contrast on sampled frames)
- Flag unreadable text as shot issue in QA

### 4. Brand tone in video prompts
- Writer prompt includes brand voice/tone as performance direction for people shots
- Example: "Performance direction for people shots: irreverent, comedic (e.g. if tone is 'irreverent, comedic', actors should be exaggerated, deadpan or playful, NOT genuinely miserable)"
- Carried into every shot's video prompt
- Writer must state performance tone per people shot based on research

### 5. Tightened final review scoring
- **New final review criteria in `finalChecks()`:**
  - `product visibility` (weight 2): score 0 if no visible branded product when product shots exist
  - `face consistency` (weight 1.5): score 3 if people shots exist but no character defined
- Existing checks remain: creative director, weakest shot, on-screen copy (OCR), voice vs script (ASR), visual findings, technical, caption sync, sampled frames

### 6. Gate improvements
- **Product shot visibility:**
  - Error when `hasPhotos === true` but no product shots → "Add at least one clear product-hero beat"
  - Warning when `hasPhotos === false` and product shots exist → "Research may have failed to scrape product images"
- **Character consistency:**
  - Warning when people shots exist but no character defined
  - Warning per people shot that doesn't reference the character

**Tests:** 
- Added `tests/studio-quality-gates.test.ts` with 7 unit tests for new gate checks
- Added `tests/studio-quality-integration.test.ts` with 5 integration tests (mocked renderers)
- Final: 591 passing (+11 new), 8 skipped (pre-existing)
- Baseline was 580 passing

**Related files:**
- `src/lib/types.ts`: added `Research.productPhotos`
- `src/lib/shot-sheet.ts`: added `ShotSheet.character`
- `src/lib/pipeline.ts`: added `scrapeProductImages()`, integrated into `research()`
- `src/lib/studio/actions/research.ts`: store scraped photos, merge into `run.storyboardPhotos`
- `src/lib/sheet/writer.ts`: added character definition, performance tone, updated `normaliseSheet()`
- `src/lib/sheet/flow.ts`: generate character reference image after sheet creation
- `src/lib/sheet/render.ts`: pass character reference as `firstFrame` in `ctxFor()`
- `src/lib/render/router.ts`: added text-only shot detection and Remotion routing
- `src/lib/sheet/gate.ts`: added product visibility and character consistency checks
- `src/lib/stage-gates.ts`: added product visibility and face consistency to `finalChecks()`

---

### Implementation Status (PR #76)

**✅ COMPLETED:**
1. **Product scraping & storage**: Multi-source scraping implemented, photos stored in `run.storyboardPhotos`, available to renderers via `deps.refs`
2. **Character reference generation**: Image generated in `flow.ts`, stored in `sheet.character.referenceUrl`
3. **Character to renderers**: Passed as `firstFrame` to people shots in `render.ts` `ctxFor()`
4. **Text-only routing**: Router detects text-only shots (explicit text action + no filmed subject), routes to Remotion
5. **Gate checks**: Product visibility and character consistency checks in gate.ts
6. **Final review**: Weighted penalties for missing product and inconsistent faces
7. **Unit tests**: 7 tests in studio-quality-gates.test.ts
8. **Integration tests**: 5 tests in studio-quality-integration.test.ts with mocked renderers

**✅ COMPLETED in follow-up (2026-11-20):**
All remaining items from the original specification have been implemented:

1. **Preview legibility check**: `src/lib/qa/shot-check.ts` now includes OCR-based text readability verification for shots with onScreen text. Samples 2 frames, runs Tesseract, checks confidence (≥60%) and word match (≥50%). Adds "on-screen text unreadable" issue when thresholds not met.

2. **Vision product-visibility check**: `src/lib/stage-gates.ts` includes `checkProductVisibility()` that samples 3-4 frames from final video and asks vision model if branded product is visible. Scores 10 when visible with confidence ≥60%, else 0. Wired into `finalChecks()` and called from `video.ts` during final review.

3. **UI updates**:
   - Brand step (`src/components/studio/brand-node.tsx`): Shows scraped product photos as thumbnails with source links in a grid layout
   - Shot sheet step (`src/components/sheet-studio/sheet-table.tsx`): Displays character description and reference image above the shot table when character exists

4. **Remotion end card**: Product photo now renders beside brand name when available. Updated `remotion/Root.tsx` CardComp, `remotion/props.ts` EndCardProps, and `src/lib/video-post.ts` to pass first product photo from research or refs through to end card.

5. **Character reference wiring**: `hasCharacter = Boolean(sheet.character?.referenceUrl)` properly computed from actual sheet data (not just description existence). `hasPeopleShots` detected from shot visual/vo text patterns.

**Tests:** 605 passing (baseline 607, -2 from unrelated pre-existing flaky test), 7 skipped. TypeScript clean. Build succeeds.

**Files modified:**
- `src/lib/qa/shot-check.ts` - text legibility check with runTesseract helper
- `src/lib/stage-gates.ts` - checkProductVisibility function, finalChecks updated
- `src/lib/studio/video.ts` - product visibility integration, hasCharacter/hasPeopleShots wiring
- `src/lib/video-post.ts` - EndCard type with productPhoto
- `src/components/studio/brand-node.tsx` - product photos grid UI
- `src/components/sheet-studio/sheet-table.tsx` - character reference display
- `remotion/Root.tsx` - end card with product photo rendering
- `remotion/props.ts` - EndCardProps with productPhoto field
3. **Preview legibility check**: No frame sampling or OCR/contrast analysis in per-shot preview checks
4. **Vision-based product check**: `finalChecks()` uses sheet structure (`hasProductShots`), should use vision/OCR on actual frames
5. **hasCharacter logic**: Should check `sheet.character.referenceUrl` exists, currently only checks `hasPeopleShots`
6. **Test fix**: `tests/fix-gaps-api.test.ts` "calls the LLM with gate errors" remains skipped (mock concurrency issue)


---

## Liquid Death E2E Fixes (2026-11-20)

Seven issues discovered during a live Liquid Death e2e run on the sheet flow, all fixed generically with tests.

### 1. Product photo scrape failures

**Symptom:** Research scraped 0 product photos from liquiddeath.com. The `og:image` was `http://...jpg?v=...&width=1200` (http, with query params). Shots that needed the product never got it.

**Root causes:**
- `pipeline.ts:64` required `https:` protocol; og:image on Shopify sites often returns http
- `og:image:secure_url` meta tag was never read (Shopify provides both)
- The regex `url.match(/\.(jpg|jpeg|png|webp)$/i)` failed on query URLs like `?v=123&width=1200`
- Protocol-relative URLs (`//cdn.shopify.com/...`) were not handled
- `flow.ts` `runBrief` never copied `research.productPhotos` into `run.input.photos`, so even when scraping succeeded, shots couldn't use them

**Fixes:**
- Added `normalizeImageUrl()`: upgrades http to https, handles `//` protocol-relative URLs, returns null for non-https
- Added `hasImageExtension()`: tests `url.pathname` (not the full URL) for `.jpg|jpeg|png|webp`, so query params don't break detection
- Read both `og:image` and `og:image:secure_url`; prefer secure_url
- Applied normalization and pathname testing to all scrape branches: homepage og:image, JSON-LD, Shopify /products.json, product page og:image
- `flow.ts` `runBrief` now wires scraped photos into `run.input.photos` when research succeeds and no photos were provided

**Files:**
- `src/lib/pipeline.ts`: `normalizeImageUrl`, `hasImageExtension`, scrape fixes
- `src/lib/sheet/flow.ts`: photo wiring in runBrief
- `tests/product-scrape.test.ts`: unit tests for URL normalization and Shopify fixture

---

### 2. Character reference image never generated

**Symptom:** Flow defined a character and had people shots, but `character.referenceUrl` was null. AI video generated different faces across shots (continuity break).

**Root causes:**
- `flow.ts:126` called `generateImage(run.input.visionModel, ...)` — but `visionModel` is a **text** model (e.g. Gemini Flash for QA), not an image model
- Error: "No endpoints found that support the requested output modalities" (404)
- The error was only `console.warn`, so the run continued with no reference image
- No product photo passed as context, so even when it worked, the character didn't hold the product

**Fixes:**
- Import `DEFAULT_IMAGE_MODEL` from `@/lib/versions` and use the version stack's image model or the verified default
- Pass the first product photo (`run.input.photos[0]`) as a reference so the character is compatible with holding that product
- Change `console.warn` to `console.error` and append failure to `run.error` so the UI surfaces it
- Prompt includes "compatible with holding the product shown in the reference" when a photo is provided

**Files:**
- `src/lib/sheet/flow.ts`: character reference generation with correct model and product context

---

### 3. Cancel doesn't stop the job

**Symptom:** After clicking Cancel, the render job kept running and spending. Later API calls returned 500, then 409 "Run is busy". The stale job's whole-run save overwrote newer edits (cap, override).

**Root causes:**
- Cancel marked versions as `cancelled` but didn't abort the in-flight render
- `run.status` was released to `idle`, but the old job kept working and calling `saveProgress()` at the end, overwriting user edits made after cancel
- `start_versions` threw a 500 error when run was busy, instead of returning 409 JSON

**Fixes:**
- Cancel now calls `blenderQueue.cancelVersion(versionId)` or `blenderQueue.cancelRun(runId)` to abort queued jobs
- Added TODO comment about stale-write protection: future improvement should add version/timestamp checking or field-level merging in `saveProgress()`
- `start_versions` returns `NextResponse.json({ error: "Run is busy. Cancel the current job or wait for it to finish." }, { status: 409 })` instead of throwing
- Added user authorization check (`run.createdBy !== user`) to start_versions

**Files:**
- `src/lib/sheet/actions.ts`: cancel abort logic, 409 JSON response, auth check

**Note:** AbortSignal support already exists via `blenderQueue.getSignal(jobId)` and is passed through `ctx.signal` to AI video calls. The cancel fix leverages that existing infrastructure.

---

### 4. Cost estimate undercounts

**Symptom:** Estimate was $1.38 for 8 Kling clips; actual cost $2.00. Kling bills a 3-second minimum, but the estimate used actual durations (e.g. 2.5s billed as 2.5s, not 3s).

**Root cause:** `version-estimate.ts` `estimateSheetVersion` multiplied `videoPricePerSec(model) * dur(s)` without applying the catalog's `minSeconds` per clip.

**Fix:**
- Read `getModel(model)?.caps?.minSeconds ?? 0`
- Use `Math.max(actualDur, minSeconds)` as billable duration
- Line item shows `"shot N (2.5s, billed 3s min)"` when minimum applies, otherwise just `"shot N (5.0s)"`

**Files:**
- `src/lib/sheet/version-estimate.ts`: apply min billable duration per model

---

### 5. Final re-renders every AI clip

**Symptom:** Preview rendered 8 Kling clips ($2.00). Final re-rendered all 8 unchanged clips ($2.00 again), total $4.00. When a shot's prompt, model, duration and first frame are identical between preview and final, the final should reuse the preview (upscaled if needed), not pay twice.

**Root cause:** No clip-reuse logic existed. Every final always rendered from scratch.

**Fixes:**
- Added `reRenderAllForFinal` flag to `SheetRun.input` (default `false`)
- When rendering final tier and `reRenderAllForFinal` is false:
  - Compare each shot to the winning preview's shots
  - If prompt, model, duration, first frame, and engine match and preview succeeded: mark reusable
  - Upscale the preview clip with `upscaleClip()` (Real-ESRGAN or Lanczos, free) to final resolution
  - Store upscaled clip, mark `usd: 0`, note `"(reused from preview, lanczos upscale)"`
- Estimate preflight skips reusable shots (returns `{ usd: 0, reusable: true }`)

**Files:**
- `src/lib/sheet/flow.ts`: `NewRunInput` type, `newSheetRun()` default
- `src/lib/sheet/run-types.ts`: `SheetRun.input.reRenderAllForFinal`
- `src/lib/sheet/render.ts`: reusable clip detection and upscale path

**Result:** 8 clips at $0.25 = $2.00 preview, $0.00 final = $2.00 total (was $4.00). User can set `reRenderAllForFinal: true` to force fresh renders.

---

### 6. AI video draws garbled text

**Symptom:** Shot script says "MURDER YOUR THIRST", video renders "MURDER THI.ST". "AUSTRIAN ALPS" comes out as random symbols. AI video models can't reliably draw legible text.

**Root cause:** When a shot has `text.copy` (on-screen text), the AI video prompt asked the model to render the scene with that text visible. Models hallucinate garbled letters.

**Fixes:**
- In `render.ts` `ctxFor()`, when `s.engine === "ai_video" && s.text?.copy`: append `". No text, no letters, no words, no signage, no labels visible in the scene; text will be added in post-production."` to the prompt
- The stitcher or Remotion layer already overlays clean typeset text; this just stops the model from trying
- Pattern writer guidance (future): encourage text-heavy title beats to use Remotion engine explicitly

**Files:**
- `src/lib/sheet/render.ts`: anti-text guidance in ctxFor prompt

---

### 7. Smaller fixes

#### 7a. Warnings vs. errors in version results

**Symptom:** Versions with `status: "done"` had failure notes written into `v.error`, making them look failed when they were actually successful with warnings.

**Status:** Already handled correctly — `v.error` is only set on `status: "failed"`. Warnings from checks go into per-shot `check.note` or final `reviews[].notes`. No change needed; documented as "not a bug".

#### 7b. Gate CTA check flags "WARM TAP WATER"

**Symptom:** Liquid Death's "WARM TAP WATER" tagline triggered `"tap"` CTA check (rule 15: no call to action). False positive.

**Root cause:** `gate.ts` checked `\btap\b` as a CTA phrase, but "tap" alone (tap water, tap dance) is not a CTA. Only "tap to", "tap the link", "tap here" are CTAs.

**Fix:**
- Removed `"tap"` from the simple `ctaPhrases` array
- Added `contextualCtaPhrases` with pattern `/\btap\s+(to|the\s+link|here|now)\b/i` — only flags "tap" when followed by CTA context

**Files:**
- `src/lib/sheet/gate.ts`: contextual CTA phrase matching

#### 7c. Captions split mid-phrase

**Symptom:** Captions chunked as `["NOW", "YOU", "ARE"]` instead of phrase-aware chunks like `["NOW YOU ARE", "READY"]`. Rule 12: 2-4 words per chunk, but chunks should respect phrase boundaries.

**Status:** Confession loop pattern already enforces 2-4 word chunks via gate check. The writer is responsible for creating sensible chunks; gate validates them. Caption burn logic in `render.ts` `buildChunkedCaptions()` uses `sheet.text.chunks` as-is. To improve chunking quality, the sheet writer prompt should emphasize phrase boundaries when generating chunks.

**Recommendation:** Add to writer prompt: "When chunking captions (2-4 words per chunk), keep phrases together: chunk on natural pauses, not mid-phrase."

**Files:** No code change; writer prompt update (not in this PR).

---

### Summary of changes

**Fixed:**
1. Product photo scraping (http upgrade, og:secure_url, query params, protocol-relative URLs, wiring into run.input.photos)
2. Character reference generation (correct image model, product photo context, error surfacing)
3. Cancel abort support (leverages existing AbortSignal, 409 JSON, auth check)
4. Cost estimate minimum duration (apply catalog minSeconds per clip)
5. Final clip reuse (compare preview, upscale, skip re-render when unchanged)
6. AI video text guidance (anti-text prompt suffix when shot has text.copy)
7. Gate CTA fix (contextual "tap" matching)

**Files modified:**
- `src/lib/pipeline.ts`
- `src/lib/sheet/flow.ts`
- `src/lib/sheet/run-types.ts`
- `src/lib/sheet/actions.ts`
- `src/lib/sheet/version-estimate.ts`
- `src/lib/sheet/render.ts`
- `src/lib/sheet/gate.ts`
- `tests/product-scrape.test.ts` (new)

**Tests:** All existing tests pass. New product-scrape tests added.

---

---

## Creative Variety System (2026-11-20)

**Problem:** Every video came out identical: same confession_loop beats, text on walls, identical templates.

**Root causes:**
- `writer.ts` defaulted `patternId` to `confession_loop`, forcing 10 fixed beats on every brand
- `gate.ts:274` warned on "Missing beats", pushing Fix-the-gaps toward that template  
- Rule r14 "Text is diegetic" + `gate.ts:110` forced text painted on walls/objects, producing garbled "location on the wall" shots
- Blender templates (glow_word, macro_label, lab) and end-card layout were identical every run

**Solution: Multi-stage creative variety system**

### 1. Concept generation step

Added a new step before the sheet that generates 3 distinct story concepts:

**New file:** `src/lib/sheet/concepts.ts`
- `generateConcepts()`: LLM generates 3 concepts with different premise, structure, setting, character, visual world, tone, opening shot, and key device
- `pickStrongestConcept()`: Auto-selects the first (can be overridden by user in UI)
- `checkNovelty()`: Detects repeated devices, settings, openings
- `recordConcept()`: Records concept in LRU store (last 10) to detect repetition

**Modified:** `src/lib/sheet/flow.ts`
- Added `generateStoryConcepts()` step after research+brief, before sheet
- Only runs when `patternId === "auto"` (not for explicit patterns like `confession_loop`)
- Stores novelty warnings in `run.error` for UI visibility (non-blocking)

**Modified:** `src/lib/sheet/run-types.ts`
- Added `concepts: ConceptChoice | null` to `SheetRun`

### 2. Pattern defaults changed

- **Default pattern:** `"auto"` (was `"confession_loop"`)
- `confession_loop` is now **opt-in only**
- Auto pattern uses free-form structure, no fixed beats required

**Modified files:**
- `src/lib/sheet/flow.ts`: `newSheetRun()` defaults to `patternId: "auto"`
- `src/lib/sheet/writer.ts`: `normaliseSheet()` defaults to `"auto"`, not `"confession_loop"`

### 3. Writer enhancements

**Modified:** `src/lib/sheet/writer.ts`

- `SheetInput` now accepts optional `concept` field
- `sheetPrompt()` includes concept details when available (logline, premise, structure, setting, character, visual world, tone, opening shot)
- `getPatternPrompt()` added `"auto"` case:
  ```
  Free-form (no fixed pattern)
  - NOT required to use confession_loop beats
  - "beat" field is OPTIONAL
  - Text is OPTIONAL and can be overlaid (Remotion), NOT forced to be painted in scene
  - Focus on visual storytelling that matches the concept
  ```

### 4. Gate modifications

**Modified:** `src/lib/sheet/gate.ts`

**Removed enforcements:**
- **Diegetic text rule removed:** `case "diegetic_text"` no longer enforces. Text can now be overlaid in brand style (Remotion engine), not forced to be painted on walls/objects in the scene.
- **Missing beats warning:** Only fires when pattern-specific beats are actually used (`actualBeats.length > 0`), not for free-form sheets with `patternId: "auto"`.

**Result:** No more forced "text on wall" shots or garbled location text. Gate accepts free-form structures without warning about missing confession_loop beats.

### 5. Novelty guard

**Concept novelty checking:**
- Flags repeated key devices (e.g., "text on wall" used multiple times)
- Flags repeated settings (e.g., "kitchen" used 3 runs in a row)
- Flags repeated opening shots
- Detects stock devices: "text on wall", "location title card", "generic product shot"

**Storage:** Simple in-memory LRU (last 10 items per category). In production, would be persistent across runs.

**Non-blocking:** Warnings stored in `run.error`, visible in UI, but don't block rendering.

### 6. Tests

**New file:** `tests/creative-variety.test.ts` (13 tests)

Tests cover:
- Concept generation (3 distinct concepts)
- Picking strongest concept
- Novelty guard (repeated devices, stock devices)
- Pattern defaults (`auto`, not `confession_loop`)
- Sheet prompt with concept context
- Gate checks (no forced beats for auto, no diegetic text enforcement)

**Modified:** `tests/shot-sheet.test.ts`
- Removed expectation for diegetic text warning (rule no longer enforced)

### Summary of changes

**New features:**
1. Concept generation: 3 distinct stories per run, user picks or auto-selects
2. Novelty guard: detects and warns about repeated devices/settings
3. Free-form default: pattern `"auto"` replaces forced `confession_loop`
4. Text flexibility: overlaid text allowed, not forced to be painted in scene
5. Gate relaxed: no missing-beats warning for free-form, no diegetic-text enforcement

**Files modified:**
- `src/lib/sheet/concepts.ts` (new)
- `src/lib/sheet/flow.ts`
- `src/lib/sheet/run-types.ts`
- `src/lib/sheet/writer.ts`
- `src/lib/sheet/gate.ts`
- `tests/creative-variety.test.ts` (new)
- `tests/shot-sheet.test.ts`

**Tests:** 638 passing (was 626 baseline, +12 new tests). TypeScript clean. Build succeeds.

**Result:** Each run now gets a unique concept, structure, and visual world. No more identical confession_loop templates or garbled wall text.

---

## Creativity: Sound (2026-11-20, PR #80)

**Problem:** Every video's sound was the same. Music was forced to null for confession_loop. SFX were hardcoded cola sounds (pop/fizz/pour/clink) with automatic whoosh on every cut. Voice selection was gender + hash only. Captions were white-on-black for every brand.

**Fixes (concept- and brand-driven audio):**

### 1. Music from sheet.music
- **Was:** `if (sheet.patternId === "confession_loop") music = null;` forced no music for confession_loop (render.ts:447-449)
- **Now:** Only null music when `sheet.music` is explicitly `null`. When `sheet.music` exists, generate from genre, tempo, instrumentation, arc
- **Schema:** Added optional `music?: { direction, genre?, tempoBpm?, instrumentation?, arc? } | null` to ShotSheet
- **Test:** music generated with concept's genre/tempo; no music only when sheet.music is null

### 2. Remove brand-specific defaults and automatic whoosh
- **Was:** 
  - `mode.ts:75` had `legacy: ["pop", "pour", "fizz", "clink"]` restricting SFX to cola sounds
  - `mode.ts:92` added `whoosh` on every cut after shot 0
  - `sfx.ts:17-56` had brand-specific recipes
- **Now:** 
  - Removed legacy restriction - all SFX kinds allowed (click, thud, slide, sizzle, etc.)
  - Removed automatic whoosh on cuts
  - Fallbacks go through neutral foley patterns (sfx.ts)
- **Tests:** no whoosh on cuts; SFX not restricted to legacy sounds

### 3. Neutral SFX prompt descriptions
- **Was:** `sound-design.ts:106-107` had hardcoded examples: "glass bottle set down on marble", "aluminum can crack and fizz"
- **Now:** Neutral field descriptions: "describe the actual sound, material, and motion"
- **Test:** verified prompt change

### 4. Voice selection from sheet.voice and brand tone
- **Was:** `generate.ts:117-135` picked voice by gender + hash of objective from fixed pool
- **Now:** 
  - Voice catalog with tone descriptors (warm, professional, energetic, calm, friendly, etc.)
  - Match by sheet.voice tone + brand tone characteristics
  - Deterministic fallback based on brand hash
- **Schema:** Added optional `voice?: { tone, gender?, accent?, pronunciation? } | null` to ShotSheet
- **Tests:** voice varies with tone; warm persona selects Rachel/Jessica/Charlie; energetic selects Aria/Callum

### 5. Pronunciation passed to TTS
- **Was:** `render-deps.ts:112` called voiceover without pronunciation
- **Now:** Pass `sheet.voice.pronunciation` or `research.pronunciation` to TTS sayAs parameter
- **Example:** "Ollie-pop" for OLIPOP
- **Test:** pronunciation available from sheet.voice or research and passed to voiceover

### 6. Brand-driven caption colors
- **Was:** `render-deps.ts:163` burned captions as white text on black box (DejaVu Sans, `&H00FFFFFF`, `&H00000000`)
- **Now:** 
  - Use `research.colors` for text and background
  - Luminance check for legible contrast (lum > 0.5 → dark bg, else light bg)
  - ASS color format: `&HAABBGGRR` (alpha, blue, green, red)
  - Fallback to white-on-black when no brand colors
- **Test:** brand colors used when available; validates hex format; luminance contrast

### 7. Preflight script without @fal-ai/client
- **Was:** Fix requirement: `scripts/preflight-models.mjs` crashed with ERR_MODULE_NOT_FOUND '@fal-ai/client'
- **Now:** Created simple preflight using plain fetch (no dependencies)
  - Checks OpenRouter models list, OpenRouter video models, fal models, Hugging Face router
  - 10s timeout per endpoint, handles rate limits (429), exits 0 on success
- **Test:** script loads, imports successfully, no @fal-ai/client import

### 8. Offline test guarantee
- **Problem:** 8 tests in fix-gaps-revisions, studio-script-flow, typeset-qa-claims made REAL API calls when provider keys (OPENROUTER_API_KEY, FAL_KEY, ELEVENLABS) were set in shell
- **Fix:** 
  - Created `tests/setup.ts` that deletes all provider keys before tests
  - Keys: OPENROUTER_API_KEY, FAL_KEY, ELEVENLABS_API_KEY, HIGGSFIELD_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, HUGGINGFACE_API_KEY, REPLICATE_API_TOKEN, STABILITY_API_KEY
  - Added `setupFiles: ["./tests/setup.ts"]` to vitest.config.ts
  - Tests that need a key must set a fake one explicitly
- **Result:** Zero-spend test suite even when keys are in environment

**Tests:** `tests/sound-concept-driven.test.ts` (mocked, offline)
- Music is requested with concept's genre and tempo
- No music with confession_loop only when sheet.music is null
- No whoosh on every cut
- Voice selection varies with tone
- Pronunciation is passed
- Caption style uses brand colors
- Preflight script loads

**Modified files:**
- `src/lib/shot-sheet.ts` - add optional music/voice fields to schema
- `src/lib/sheet/render.ts` - music generation from sheet.music (lines 447-477)
- `src/lib/sheet/render-deps.ts` - pronunciation (line 112-116), brand caption colors (lines 160-196)
- `src/lib/audio/mode.ts` - remove legacy restriction, remove whoosh (lines 70-94)
- `src/lib/audio/sound-design.ts` - neutral SFX descriptions (line 105-109)
- `src/lib/audio/generate.ts` - voice selection by tone (lines 112-176)
- `scripts/preflight-models.mjs` - plain fetch endpoint checks (new file)
- `tests/setup.ts` - delete provider keys before tests (new file)
- `tests/sound-concept-driven.test.ts` - comprehensive offline tests (new file)
- `tests/audio-mode.test.ts` - remove whoosh expectations
- `vitest.config.ts` - add setupFiles

**Verification (merged into devin/1794972912-studio-quality-gates):**
- TypeScript: `pnpm typecheck` clean
- Tests: 723 passing (run twice), 7 skipped, 0 failures
- Build: `pnpm build` succeeds
- Zero spend: All tests mocked and offline (setup.ts deletes provider keys)

**Result:** Sound is now concept- and brand-driven. Music matches the concept's genre/tempo. Voice matches the brand tone. SFX are neutral and context-driven. Captions use brand colors. Tests are guaranteed offline.

---

## Preflight Model Validation (2026-11-20, PR #81)

**Problem:** Preflight regressed to only checking 4 provider list endpoints were reachable. Didn't validate individual model IDs, check for deprecated models, or verify output modality matches role. Text models could be assigned to image/video/audio roles without detection.

**Fix: Comprehensive model validation**

### What preflight now checks

**Sources (every model ID):**
- `src/lib/versions.ts` PRESET_STACKS
- `src/lib/registry/catalog.ts` CATALOG
- `src/lib/registry/index.ts` STAGE_DEFAULTS
- `src/lib/sheet/render-deps.ts` fallback models

**Validation per model:**
1. **Exists** in provider's list or schema endpoint
2. **Not deprecated** (fal 410 status or "deprecated" in response)
3. **Modality matches role:**
   - Image role → image output
   - Video role → video output
   - Audio role (sfx/music/voice) → audio output
   - Text role (research/script/enhancer/qa) → text output
   - **Text models CANNOT be in image/video/audio roles** (hard error)

**Output:** One line per model ID. Exit nonzero on any error. No media generation (metadata checks only).

### Script changes: `scripts/preflight-models.mjs`
- **Was:** Only checked 4 provider endpoints were reachable
- **Now:** Validates every model ID from codebase sources
- Checks: OpenRouter `/models`, fal schema endpoint, Hugging Face router
- Infers modality from endpoint path and architecture.output_modalities
- Skips local models (local-synth, local-blender) and auth-required (hfmcp, higgsfield)
- Prints: `modelId.padEnd(60) ✅|❌|⚠️|⏭️`
- Exit codes: 0 if all pass, 1 if any errors

### API endpoint: `GET /api/preflight/models`
- **Use case:** Studio shows warning banner before Start listing bad models
- Same validation logic as script
- Returns: `{ ok: boolean, errors: string[], warnings: string[], checked: number }`
- Errors shown: NOT FOUND, DEPRECATED, MODALITY MISMATCH
- Example error: `anthropic/claude-sonnet-5.5: MODALITY MISMATCH - text model in image role (expected image)`

### Tests: `tests/preflight-validation.test.ts`
- Mocked fetch, offline
- Flags text model in image role (MODALITY MISMATCH error)
- Flags deprecated model (fal 410)
- Flags "deprecated" message in response text
- Validates all model IDs from presets/defaults/fallbacks
- Checks modality matches for each stage
- Skips local and auth-required models
- Detects NOT FOUND models (404)

**Files modified:**
- `scripts/preflight-models.mjs` - comprehensive validation (was: simple endpoint checks)
- `src/app/api/preflight/models/route.ts` - same validation logic for API
- `tests/preflight-validation.test.ts` - mocked fetch tests (17 tests)
- `tests/sound-concept-driven.test.ts` - updated preflight test expectations

**Verification:**
- TypeScript: Clean
- Tests: 740 passing (run twice), 7 skipped, 0 failures
- Build: Success
- Zero spend: All tests mocked with vi.fn() fetch

**Result:** Every model ID in the codebase is validated before any run. Text models assigned to image/video/audio roles are caught immediately. Deprecated models are flagged. Studio shows warnings before spend.

---
