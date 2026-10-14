export interface RawEntry {
  url: string;
  guid: string | null;
  title: string | null;
  publishedAt: Date | null;
}

export interface SitemapUrl {
  url: string;
  lastmod: Date | null;
}
