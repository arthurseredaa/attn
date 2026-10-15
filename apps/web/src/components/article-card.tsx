import { readingMinutes, type ArticleCard } from '@attn/shared';
import { SkillChip } from '@/components/skill-chip';

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });

export function ArticleCardView({ article }: { article: ArticleCard }) {
  const minutes = readingMinutes(article.wordCount);
  return (
    <article className="rounded-xl border border-border bg-card p-4">
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
      {article.skills.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {article.skills.map((s) => (
            <li key={s.id}>
              <SkillChip name={s.name} primary={s.isPrimary} />
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
