import { PageHeader } from "@/components/page-header";
import { LibraryClient } from "@/components/library-client";
import { list } from "@/lib/store";

export default async function LibraryPage() {
  const creatives = await list("creatives");
  return (
    <div>
      <PageHeader title="Library" subtitle="Every creative with its QA score, distinctness, status and live performance" />
      <LibraryClient initial={creatives} />
    </div>
  );
}
