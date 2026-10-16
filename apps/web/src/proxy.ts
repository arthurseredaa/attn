import { NextResponse } from 'next/server';
import { robotsTag } from '@/lib/indexing';

// A header, not metadata: it covers redirects too, and page-level `robots` cannot override it. Responses from the
// /api/* rewrite to the API do not get it (checked with curl).
// Read per request, so opening the site at launch needs a restart with SITE_INDEXABLE=true, not a rebuild.
export function proxy() {
  const response = NextResponse.next();
  const tag = robotsTag(process.env.SITE_INDEXABLE);
  if (tag) response.headers.set('X-Robots-Tag', tag);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
