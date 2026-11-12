export interface ConnectionDef {
  id: string;
  name: string;
  group: "AI & Media" | "Data sources" | "Publishing" | "Signals" | "Infrastructure";
  envs: string[];
  note: string;
}

export const CONNECTIONS: ConnectionDef[] = [
  { id: "openrouter", name: "OpenRouter", group: "AI & Media", envs: ["OPENROUTER_API_KEY"], note: "Text, vision QA, image models and Gemini Omni video" },
  { id: "openai", name: "OpenAI", group: "AI & Media", envs: ["OPENAI_API_KEY"], note: "GPT models (Astra, Sol) called directly instead of via OpenRouter; Script Lab writes with Astra when set" },
  { id: "fal", name: "fal.ai", group: "AI & Media", envs: ["FAL_KEY"], note: "Seedance, Kling and other premium video models" },
  { id: "higgsfield", name: "Higgsfield", group: "AI & Media", envs: ["HF_API_KEY"], note: "Image and video models via Higgsfield (HF_API_KEY, or HF_API_KEY_ID + HF_API_KEY_SECRET)" },
  { id: "supabase", name: "Supabase", group: "Infrastructure", envs: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"], note: "Database, storage and auth (in-memory demo store until set)" },
  { id: "meta_ads", name: "Meta Marketing API", group: "Publishing", envs: ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID", "META_PAGE_ID"], note: "Read insights + create PAUSED ads (needs ads_management and the Facebook Page the ads run from)" },
  { id: "google_ads", name: "Google Ads API", group: "Publishing", envs: ["GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_CUSTOMER_ID", "GOOGLE_ADS_REFRESH_TOKEN"], note: "Read metrics + create paused campaigns" },
  { id: "ga4", name: "Google Analytics 4", group: "Data sources", envs: ["GA4_PROPERTY_ID", "GOOGLE_SERVICE_ACCOUNT_JSON"], note: "Sessions and conversions" },
  { id: "stripe", name: "Stripe", group: "Data sources", envs: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"], note: "Revenue, LTV and purchase events for the signal loop" },
  { id: "hubspot", name: "HubSpot", group: "Data sources", envs: ["HUBSPOT_TOKEN"], note: "Leads and pipeline stages" },
  { id: "posthog", name: "PostHog", group: "Data sources", envs: ["POSTHOG_API_KEY", "POSTHOG_PROJECT_ID"], note: "Product events and activation" },
  { id: "meta_capi", name: "Meta Conversions API", group: "Signals", envs: ["META_PIXEL_ID", "META_CAPI_TOKEN"], note: "Server-side events, SHA-256 hashed" },
  { id: "google_offline", name: "Google Data Manager / offline conversions", group: "Signals", envs: ["GOOGLE_ADS_CONVERSION_ACTION_ID"], note: "Offline conversions and LTV upload" },
];

export function connectionStatus() {
  return CONNECTIONS.map((c) => {
    const set = c.id === "higgsfield" && process.env.HF_API_KEY_ID && process.env.HF_API_KEY_SECRET ? c.envs : c.envs.filter((e) => !!process.env[e]);
    return { ...c, configured: set.length === c.envs.length, partial: set.length > 0 && set.length < c.envs.length };
  });
}
