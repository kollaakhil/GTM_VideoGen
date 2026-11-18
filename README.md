# GTM Engine

AI marketing studio: brand research → brief → three directions → image/video creatives → Vision QA gate → approval inbox → Meta / Google publishing, with performance data and a server-side signal loop (Meta CAPI) in Supabase.

## Stack
Next.js 15 (App Router) · Tailwind + shadcn/ui · Supabase (Postgres + Storage) · OpenRouter (text, vision, image, Gemini Omni video) · fal.ai / Higgsfield (extra video models)

## Run locally
```bash
pnpm install
cp .env.example .env.local   # fill in what you have
pnpm dev
```
Without keys the app runs in **demo mode**: an in-memory store with sample data and placeholder creatives.

## Script Lab

In a video direction, confirm one buyer tension, one claim from saved research, a proposed scene that demonstrates the claim, exact offer terms, and one CTA. A proof attachment is optional for scripts. Storyboards reuse real product photos saved to the brand kit; an uploaded proof photo is an optional extra reference. External links are for operator review and are not fetched by Studio. Inferred objections are not testimonials. Only use buyer quotes matched to a source excerpt.

Click **Write script** to use the recommended opening, or choose an alternative. The story follows [Colin and Samir’s hook pattern](https://www.youtube.com/shorts/FliP14zJKbY): set a goal and stakes, introduce the obstacle, give a plan, then show it in action and reveal the payoff before the CTA. Studio locks the chosen opening and, if needed, retries a single later beat. Use **Timed read-aloud** to step through estimated VO timing and 9:16 overlay previews without rendering video. The preview is a layout check, not a finished frame or an audience test.

`npm run eval:scripts` runs the offline fixture. To compare writers or graders, hold the brief, opening and duration fixed, hide the model label from human reviewers, and record the ratings before revealing model results. Set `SCRIPT_EVAL_FILE` to a local JSON array of cases with `{ id, lengthSec, mustSay, proof, candidates }`. Each candidate includes the saved script’s `id`, `framework`, `hook`, `beats`, `cta`, plus `writer`, optional `human` ratings (`overall`, `hook`, `emotion`, `specificity`, `productTruth`, `visualProof`, `clarity`, `cta`, `phoneCopy`), and optional `grades: [{ judge, overall }]`. The benchmark uses recorded outputs only; it reports local blockers and disagreement with human ratings without calling any model.

## Studio video quality

Approve any script; its score is guidance only. Approval unlocks storyboard keyframes using real product photos. Generate a private 480p draft to test the workflow without waiting for script or keyframe quality scores. Complete keyframes, real product references, verified voice tracks and budget checks still apply. Drafts with script or keyframe warnings record them in QA and cannot unlock HD. Studio locks the approved beats into the edit. FFmpeg scans every decoded source frame for technical defects; vision reviews timestamped samples on each shot. Every export size gets OCR and loudness checks, and the primary export gets shot-window speech and visual checks. A clean script, passing 9/10 keyframes and passing draft QA unlock HD. HD must pass again before an Inbox publishing request.

Run Studio on a Node host with FFmpeg (bundled via `ffmpeg-static`) and [Tesseract](https://tesseract-ocr.github.io/). On Ubuntu, install `tesseract-ocr` and the pack for `OCR_LANG` (English: `tesseract-ocr-eng`). Set `TESSERACT_BIN` if it isn't on PATH. Make those tools available on the **runtime** host, not only during build.

For offline speech QA, install [whisper.cpp](https://github.com/ggml-org/whisper.cpp) and download a model for the video's language. Set `WHISPER_BIN`, `WHISPER_MODEL_PATH`, and `WHISPER_LANG` before starting the app. When no local model is configured, Studio uses fal Whisper; a configured but broken local adapter does not silently fall back. Voice generation still uses fal.ai and visual grading still uses the configured vision model.

Use **Repair and recheck** in Studio after a QA failure. Matching verified takes and voice tracks are reused; claims, score and rendered files are checked again. A changed script, keyframe or provider configuration invalidates the affected work. FFmpeg handles overlay and caption layout, so a copy repair need not regenerate any video shot.

The review and repair flow adapts [Graphed’s UGC Studio](https://github.com/graphed-inc/marketing-skills/tree/main/skills/ugc-studio) and [filmstrip review](https://github.com/graphed-inc/marketing-skills/blob/main/skills/tesseract-motion/references/filmstrip-review.md) patterns without adding a Graphed service dependency.

The local `npm test` suite exercises release policy and synthetic media without calling providers. The OCR tests run when Tesseract and its language pack are present. For a real-brand rollout, validate automated grades against human judgments; a passing model score is not measured ad performance.

## Supabase
Set `DATABASE_URL` (Supabase Postgres connection string), `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, then run `node scripts/db-migrate.mjs` to create the private `gtm` schema and `gtm-media` bucket. `node scripts/import-local.mjs` copies an existing local `.data` store (rows and media) into Supabase.

## Pages
- **Studio**: chat + canvas pipeline with approve/redo at each step
- **Library**: creatives with QA score, distinctness, status, live KPIs
- **Campaigns**: synced Meta / Google campaigns
- **Performance**: spend, revenue, ROAS by angle, signal-loop log
- **Inbox**: approvals for anything that spends money (ads are created PAUSED)
- **Connections**: integration health from env vars

## Signal loop
`POST /api/webhooks/stripe` verifies the Stripe signature, SHA-256 hashes the customer email and sends a `Purchase` event to Meta CAPI.
