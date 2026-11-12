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
