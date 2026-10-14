import { z } from 'zod';

const pathPrefix = z.string().min(1).startsWith('/');

export const sourceFilterSchema = z.object({
  path_prefix: z.array(pathPrefix).min(1).optional(),
  exclude_path_prefix: z.array(pathPrefix).min(1).optional(),
  keywords: z.array(z.string().min(1)).min(1).optional(),
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
    if (seen.has(s.id)) {
      ctx.addIssue({ code: 'custom', path: [i, 'id'], message: `duplicate source id: ${s.id}` });
    }
    seen.add(s.id);
  });
});
