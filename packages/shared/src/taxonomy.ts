import { z } from 'zod';

const taxonomyLevelSchema = z.object({
  level: z.number().int().min(0).max(4),
  label: z.string().min(1),
  description: z.string().min(1),
});

const skillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  roles: z.array(z.string().min(1)).min(1),
});

const domainSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  skills: z.array(skillSchema),
});

export const taxonomySchema = z
  .object({
    version: z.number(),
    levels: z.array(taxonomyLevelSchema).length(5),
    domains: z.array(domainSchema),
  })
  .superRefine((t, ctx) => {
    const levelNums = new Set(t.levels.map((l) => l.level));
    if (levelNums.size !== 5) {
      ctx.addIssue({ code: 'custom', path: ['levels'], message: 'levels must cover 0..4 exactly once' });
    }
    const domainIds = new Set<string>();
    const skillIds = new Set<string>();
    t.domains.forEach((d, di) => {
      if (domainIds.has(d.id)) {
        ctx.addIssue({ code: 'custom', path: ['domains', di, 'id'], message: `duplicate domain id: ${d.id}` });
      }
      domainIds.add(d.id);
      d.skills.forEach((s, si) => {
        if (skillIds.has(s.id)) {
          ctx.addIssue({
            code: 'custom',
            path: ['domains', di, 'skills', si, 'id'],
            message: `duplicate skill id: ${s.id}`,
          });
        }
        skillIds.add(s.id);
      });
    });
  });
export type Taxonomy = z.infer<typeof taxonomySchema>;

/** skill id -> name over every domain; takes a Taxonomy or anything shaped like it (e.g. a Profile). */
export function skillNameMap(t: {
  domains: readonly { skills: readonly { id: string; name: string }[] }[];
}): Record<string, string> {
  const names: Record<string, string> = {};
  for (const d of t.domains) for (const s of d.skills) names[s.id] = s.name;
  return names;
}
