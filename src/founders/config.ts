import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";

const foundersSchema = z.object({
  news: z.object({
    queries: z.array(z.string()).min(1),
    days: z.number().int().positive().default(7),
    keywords: z.array(z.string()).default(["rais", "funding", "seed", "series [a-c]"]),
    exclude: z.array(z.string()).default([]),
  }),
  /** Role groups → job titles. A company is emailed when any group has no one in it. */
  role_groups: z.record(z.string(), z.array(z.string().min(2)).min(1)).refine((g) => Object.keys(g).length > 0, "needs a group"),
  max_founders_per_company: z.number().int().positive().default(3),
  /** Skip companies with more people than this (headcount from Exa). Unknown sizes are kept. */
  max_employees: z.number().int().positive().default(50),
  /** Companies checked per run, at most; the rest wait for the next run. */
  max_companies: z.number().int().positive().default(20),
  /** Searches per run, at most, for each provider. */
  limits: z
    .object({
      exa: z.number().int().nonnegative().default(60),
      google: z.number().int().nonnegative().default(30),
      pdl: z.number().int().nonnegative().default(45),
    })
    .default({ exa: 60, google: 30, pdl: 45 }),
});

export type FoundersConfig = z.infer<typeof foundersSchema>;

export async function loadFoundersConfig(path = "config/founders.yaml"): Promise<FoundersConfig> {
  const result = foundersSchema.safeParse(parse(await readFile(path, "utf8")));
  if (!result.success) throw new Error(`Invalid config in ${path}:\n${z.prettifyError(result.error)}`);
  return result.data;
}

/** Every title in every group, in order. */
export const allTitles = (config: FoundersConfig) => Object.values(config.role_groups).flat();
