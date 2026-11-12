import { PageHeader } from "@/components/page-header";
import { BrandsClient } from "@/components/brands-client";
import { list } from "@/lib/store";
import { learnings } from "@/lib/learnings";

export default async function BrandsPage() {
  const brands = (await list("brands")).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const learned = Object.fromEntries(await Promise.all(brands.map(async (b) => [b.id, await learnings(b.url)] as const)));
  return (
    <div>
      <PageHeader title="Brand kits" subtitle="Logo, fonts, colors, voice, rules and past winners. Every run for this brand follows them." />
      <BrandsClient initial={brands} learned={learned} />
    </div>
  );
}
