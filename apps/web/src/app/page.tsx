import { CircleAlert } from 'lucide-react';
import { authErrorMessage } from '@attn/shared';
import { LandingStory } from '@/components/landing/landing-story';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { getArticles, getMe, getSources, getTaxonomy } from '@/lib/api';
import { toBoardData } from '@/lib/landing-board';

/** The newest articles the board is drawn from. */
const STORY_POOL = 40;

export default async function Landing({ searchParams }: { searchParams: Promise<{ auth_error?: string | string[] }> }) {
  const params = await searchParams;
  const code = Array.isArray(params.auth_error) ? params.auth_error[0] : params.auth_error;
  const error = authErrorMessage(code); // fixed messages only; never echoes the query text
  // The story draws real data; if any of it fails, the acts render as text and the page still works.
  const [me, articles, sources, taxonomy] = await Promise.all([
    getMe(),
    getArticles({ limit: STORY_POOL }).catch(() => null),
    getSources().catch(() => null),
    getTaxonomy().catch(() => null),
  ]);
  const data = articles && taxonomy ? toBoardData(articles.items, sources, taxonomy) : null;
  const alert = error ? (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : null;

  return <LandingStory data={data} sourceCount={sources?.length ?? null} signedIn={me !== null} alert={alert} />;
}
