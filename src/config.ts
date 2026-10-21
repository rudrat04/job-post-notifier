import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";

const atsSchema = z.enum(["greenhouse", "lever", "ashby", "workable"]);

const companiesSchema = z.object({
  companies: z
    .array(
      z.union([
        z.string().url().transform((url): { url: string; name?: string } => ({ url })),
        z.object({
          url: z.string().url(),
          name: z.string().optional(),
          ats: atsSchema.optional(),
          slug: z.string().optional(),
        }),
      ]),
    )
    .default([]),
});

const filtersSchema = z
  .object({
  /** Regex fragments; a job title must match at least one (word-bounded, case-insensitive). */
  titles: z.array(z.string()).default([]),
  /**
   * Mix-and-match titles. Each combo is a list of word groups; a title matches
   * a combo when it contains at least one word from EVERY group, in any order.
   */
  title_combos: z.array(z.array(z.array(z.string()).min(1)).min(2)).default([]),
  /** Reject a job whose title matches any of these. */
  exclude_title: z.array(z.string()).default([]),
  /** Reject a job whose description matches any of these. */
  exclude_description: z.array(z.string()).default([]),
  /** If non-empty, the title or description must match at least one. */
  include_keywords: z.array(z.string()).default([]),
  /** Drop jobs posted more than this many days ago. Omit or set 0 to disable. */
  max_age_days: z.number().nonnegative().default(0),
  /** Keep jobs whose posting date is unknown (some boards don't publish one). */
  keep_undated: z.boolean().default(true),
  locations: z.object({
    /** On-site/hybrid locations that are always accepted. */
    cities: z.array(z.string()).default([]),
    /** Regions a remote job may be limited to and still be accepted. */
    remote_regions: z.array(z.string()).default([]),
    /** Accept remote jobs that name no country or region at all. */
    remote_anywhere: z.boolean().default(true),
    /** Keep jobs that have no location listed (they are flagged in the email). */
    keep_missing: z.boolean().default(true),
  }),
 })
  .refine((f) => f.titles.length > 0 || f.title_combos.length > 0, {
    message: "Set at least one of titles or title_combos",
  });

const whereList = z.object({ where: z.array(z.string()).min(1) });

const searchSchema = z.object({
  /** Keywords sent to every search source. */
  queries: z.array(z.string()).min(1),
  workable: z.object({ locations: z.array(z.string()).min(1) }).optional(),
  /** Needs ADZUNA_APP_ID and ADZUNA_APP_KEY; skipped if they are missing. */
  adzuna: whereList.optional(),
  /** Needs JOOBLE_API_KEY. */
  jooble: whereList.optional(),
  /** Needs RAPIDAPI_KEY. Own query list and a request cap, as the free tier is small. */
  jsearch: z
    .object({
      queries: z.array(z.string()).min(1),
      where: z.array(z.string()).min(1),
      max_requests: z.number().int().positive().default(3),
    })
    .optional(),
});

export type SearchConfig = z.infer<typeof searchSchema>;
export type Filters = z.infer<typeof filtersSchema>;
export type CompaniesConfig = z.infer<typeof companiesSchema>;

async function loadYaml<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const raw = parse(await readFile(path, "utf8"));
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid config in ${path}:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export const loadCompanies = (path = "config/companies.yaml") => loadYaml(path, companiesSchema);
export const loadFilters = (path = "config/filters.yaml") => loadYaml(path, filtersSchema);

/** The search file is optional; without it only the listed companies are checked. */
export async function loadSearch(path = "config/search.yaml"): Promise<SearchConfig | null> {
  try {
    return await loadYaml(path, searchSchema);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** The discovered-companies file is optional; it is written by `npm run discover`. */
export async function loadDiscovered(path = "config/discovered.yaml") {
  try {
    return await loadCompanies(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { companies: [] };
    throw err;
  }
}
