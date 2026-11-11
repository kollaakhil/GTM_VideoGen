import { PageHeader } from "@/components/page-header";
import { InboxClient } from "@/components/inbox-client";
import { list } from "@/lib/store";

export default async function InboxPage() {
  const [items, creatives] = await Promise.all([list("inbox_items"), list("creatives")]);
  const media = Object.fromEntries(creatives.map((c) => [c.id, c.mediaUrl]));
  return (
    <div>
      <PageHeader title="Inbox" subtitle="Anything that spends money or touches an ad account waits here for your approval" />
      <InboxClient initial={items} media={media} />
    </div>
  );
}
