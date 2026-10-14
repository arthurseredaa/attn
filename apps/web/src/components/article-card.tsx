import { readingMinutes, type ArticleCard } from '@attn/shared';

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });

export function ArticleCardView({ article }: { article: ArticleCard }) {
  const minutes = readingMinutes(article.wordCount);
  return (
    <article className="rounded-xl border border-line bg-card p-4">
      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold hover:underline"
      >
        {article.title}
      </a>
      <p className="mt-1 text-sm text-muted">
        {article.sourceName} · {dateFormat.format(new Date(article.publishedAt))}
        {minutes !== null ? ` · ${minutes} min read` : ''}
      </p>
      {article.skills.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {article.skills.map((s) => (
            <li
              key={s.id}
              className={`rounded-full px-2.5 py-0.5 text-xs ${s.isPrimary ? 'bg-accent text-accent-fg' : 'bg-accent-soft'}`}
            >
              {s.name}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
