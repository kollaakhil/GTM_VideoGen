import { PageHeader } from "@/components/page-header";
import { BrandsClient } from "@/components/brands-client";
import { list } from "@/lib/store";

export default async function BrandsPage() {
  const brands = (await list("brands")).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div>
      <PageHeader title="Brand kits" subtitle="Logo, fonts, colors, voice, rules and past winners. Every run for this brand follows them." />
      <BrandsClient initial={brands} />
    </div>
  );
}
