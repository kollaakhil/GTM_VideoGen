import { StudioClient } from "@/components/studio-client";
import { MODELS, DEFAULTS, providerConfigured } from "@/lib/models";

export default function StudioPage() {
  const models = MODELS.map((m) => ({ ...m, ready: providerConfigured(m.provider) }));
  return <StudioClient models={models} defaults={DEFAULTS} />;
}
