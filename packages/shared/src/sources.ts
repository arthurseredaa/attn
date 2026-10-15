import { z } from 'zod';

const pathPrefix = z.string().min(1).startsWith('/');

export const sourceFilterSchema = z.object({
  path_prefix: z.array(pathPrefix).min(1).optional(),
  exclude_path_prefix: z.array(pathPrefix).min(1).optional(),
  keywords: z.array(z.string().min(1)).min(1).optional(),
  /** Exact URL path match (trailing slash ignored). */
  exclude_paths: z.array(pathPrefix).min(1).optional(),
  /** Regex (case-sensitive) tested against the URL path. */
  exclude_path_regex: z.array(z.string().min(1)).min(1).optional(),
  /** Regex (case-insensitive) tested against the article title. */
  exclude_title_regex: z.array(z.string().min(1)).min(1).optional(),
});
export type SourceFilter = z.infer<typeof sourceFilterSchema>;

const base = {
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url(),
  filter: sourceFilterSchema.optional(),
};

export const sourceSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('rss') }),
  z.object({ ...base, type: z.literal('sitemap'), path_prefix: pathPrefix }),
]);
export type Source = z.infer<typeof sourceSchema>;

export const sourcesSchema = z.array(sourceSchema).superRefine((sources, ctx) => {
  const seen = new Set<string>();
  sources.forEach((s, i) => {
    for (const key of ['exclude_path_regex', 'exclude_title_regex'] as const) {
      s.filter?.[key]?.forEach((pattern, j) => {
        try {
          new RegExp(pattern, key === 'exclude_title_regex' ? 'i' : '');
        } catch (e) {
          ctx.addIssue({
            code: 'custom',
            path: [i, 'filter', key, j],
            message: `source ${s.id}: invalid regex in filter.${key}: ${JSON.stringify(pattern)} (${e instanceof Error ? e.message : String(e)})`,
          });
        }
      });
    }
    if (seen.has(s.id)) {
      ctx.addIssue({ code: 'custom', path: [i, 'id'], message: `duplicate source id: ${s.id}` });
    }
    seen.add(s.id);
  });
});
