import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";

const prospectsSchema = z.object({
  budget: z.object({
    max_requests_per_month: z.number().int().positive().max(900),
    max_requests_per_run: z.number().int().positive(),
  }),
  cities: z.array(z.string()).min(1),
  queries: z.array(z.string()).min(1),
  use_reviews: z.boolean().default(true),
  min_reviews: z.number().int().nonnegative().default(20),
  max_reviews: z.number().int().positive().default(3000),
  min_score: z.number().nonnegative().default(3),
  max_per_email: z.number().int().positive().default(25),
});

export type ProspectsConfig = z.infer<typeof prospectsSchema>;

export async function loadProspectsConfig(path = "config/prospects.yaml"): Promise<ProspectsConfig> {
  const result = prospectsSchema.safeParse(parse(await readFile(path, "utf8")));
  if (!result.success) throw new Error(`Invalid config in ${path}:\n${z.prettifyError(result.error)}`);
  return result.data;
}

/**
 * The next `count` (query, city) pairs for this run, rotating weekly so every pair gets
 * its turn: week 0 takes pairs 0..count-1, week 1 the next count, and so on.
 */
export function planSearches(config: ProspectsConfig, count: number, now = Date.now()) {
  const all = config.cities.flatMap((city) => config.queries.map((query) => ({ query, city })));
  const n = Math.min(count, all.length);
  const week = Math.floor(now / (7 * 86_400_000));
  const start = (week * n) % all.length;
  return Array.from({ length: n }, (_, i) => all[(start + i) % all.length]);
}

/** "https://www.livspace.com/in/interiors/pune?x" → "livspace.com" */
export function siteDomain(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}

/** Drops branches of chains: any website domain that more than one business shares. */
export function dropChains<T extends { website?: string }>(places: T[]): T[] {
  const counts = new Map<string, number>();
  for (const p of places) {
    const d = siteDomain(p.website);
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return places.filter((p) => {
    const d = siteDomain(p.website);
    return !d || counts.get(d) === 1;
  });
}
