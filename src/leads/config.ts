import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";

const leadsSchema = z.object({
  /** Drop leads older than this many days. */
  max_age_days: z.number().positive().default(2),
  /**
   * For reddit, hackernews and freelancer posts: the post must mention one of the
   * services you sell (`services`), show buying intent (`intent`), and not be someone
   * offering their own services (`exclude`). Regex fragments, case-insensitive.
   */
  services: z.array(z.string()).min(1),
  intent: z.array(z.string()).min(1),
  exclude: z.array(z.string()).default([]),
  reddit: z
    .object({
      /** Searched together, so one request covers all of them. */
      subreddits: z.array(z.string()).min(1),
      /** Combined into a few "a OR b OR c" searches, because Reddit rate-limits many requests. */
      queries: z.array(z.string()).min(1),
      queries_per_search: z.number().int().positive().default(12),
    })
    .optional(),
  hackernews: z.object({ queries: z.array(z.string()).min(1) }).optional(),
  freelancer: z
    .object({
      queries: z.array(z.string()).min(1),
      /** Skip projects whose top budget is below this (converted to USD). */
      min_budget_usd: z.number().nonnegative().default(0),
      /** Skip projects that already have more bids than this. */
      max_bids: z.number().int().positive().default(1000),
      max_per_run: z.number().int().positive().default(10),
    })
    .optional(),
  /** Funding news (Google News). Every matching story is a lead; no intent check. */
  funding: z
    .object({
      queries: z.array(z.string()).min(1),
      /** Stories must match one of these to count as a funding round. */
      keywords: z.array(z.string()).default(["rais", "funding", "seed", "series [a-c]"]),
      max_per_run: z.number().int().positive().default(10),
    })
    .optional(),
});

export type LeadsConfig = z.infer<typeof leadsSchema>;

export async function loadLeadsConfig(path = "config/leads.yaml"): Promise<LeadsConfig> {
  const result = leadsSchema.safeParse(parse(await readFile(path, "utf8")));
  if (!result.success) throw new Error(`Invalid config in ${path}:\n${z.prettifyError(result.error)}`);
  return result.data;
}
