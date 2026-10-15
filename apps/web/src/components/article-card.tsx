import { readingMinutes, type ArticleCard } from '@attn/shared';
import { SkillSummary } from '@/components/skill-summary';

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });

export function ArticleCardView({ article }: { article: ArticleCard }) {
  const minutes = readingMinutes(article.wordCount);
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold hover:underline"
      >
        {article.title}
      </a>
      <p className="mt-1 text-sm text-muted-foreground">
        {article.sourceName} · {dateFormat.format(new Date(article.publishedAt))}
        {minutes !== null ? ` · ${minutes} min read` : ''}
      </p>
      <SkillSummary skills={article.skills} className="mt-3" />
    </article>
  );
}
