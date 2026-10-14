import { getFeed } from '@/lib/api';
import { requireProfile, signedIn } from '@/lib/guards';
import { FeedList } from '@/components/feed-list';

export const metadata = { title: 'For you | ATTN' };
export const dynamic = 'force-dynamic';

export default async function ForYouPage() {
  await requireProfile();
  const page = await signedIn(getFeed(0));
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">For you</h1>
      <FeedList initial={page} />
    </div>
  );
}
