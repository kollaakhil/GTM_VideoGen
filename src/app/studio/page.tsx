import { PageHeader } from "@/components/page-header";
import { StudioClient } from "@/components/studio-client";
import { MODELS, DEFAULTS, providerConfigured } from "@/lib/models";

export default function StudioPage() {
  const models = MODELS.map((m) => ({ ...m, ready: providerConfigured(m.provider) }));
  return (
    <div className="flex h-screen flex-col">
      <PageHeader title="Studio" subtitle="Brand URL + goal → research, brief, three directions, creatives, QA and publish" />
      <StudioClient models={models} defaults={DEFAULTS} />
    </div>
  );
}
