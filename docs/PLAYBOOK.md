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
