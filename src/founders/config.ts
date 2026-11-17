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
  /** Job titles that, if anyone at the company holds one, rule the company out. */
  roles: z.array(z.string().min(2)).min(1),
  max_founders_per_company: z.number().int().positive().default(3),
  /** Companies checked per run, at most; the rest wait for the next run. */
  max_companies: z.number().int().positive().default(20),
  /** Searches per run, at most, for each provider. */
  limits: z
    .object({
      exa: z.number().int().nonnegative().default(45),
      google: z.number().int().nonnegative().default(20),
      pdl: z.number().int().nonnegative().default(20),
    })
    .default({ exa: 45, google: 20, pdl: 20 }),
});

export type FoundersConfig = z.infer<typeof foundersSchema>;

export async function loadFoundersConfig(path = "config/founders.yaml"): Promise<FoundersConfig> {
  const result = foundersSchema.safeParse(parse(await readFile(path, "utf8")));
  if (!result.success) throw new Error(`Invalid config in ${path}:\n${z.prettifyError(result.error)}`);
  return result.data;
}
