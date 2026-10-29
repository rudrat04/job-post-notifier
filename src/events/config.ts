import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";

const eventsSchema = z.object({
  window_days: z.number().int().positive().default(30),
  cities: z
    .array(
      z.object({
        name: z.string(),
        lat: z.number(),
        lon: z.number(),
        places: z.array(z.string()).min(1),
      }),
    )
    .min(1),
  virtual: z.boolean().default(true),
  topics: z.array(z.string()).min(1),
  exclude: z.array(z.string()).default([]),
  big: z
    .object({
      min_guests: z.number().int().positive().default(200),
      brands: z.array(z.string()).default([]),
      community_words: z.array(z.string()).default([]),
    })
    .default({ min_guests: 200, brands: [], community_words: [] }),
  luma: z.object({ max_pages: z.number().int().positive().default(4) }).default({ max_pages: 4 }),
  meetup: z
    .object({ online_queries: z.array(z.string()).default([]) })
    .default({ online_queries: [] }),
});

export type EventsConfig = z.infer<typeof eventsSchema>;
export type City = EventsConfig["cities"][number];

export async function loadEvents(path = "config/events.yaml"): Promise<EventsConfig> {
  const result = eventsSchema.safeParse(parse(await readFile(path, "utf8")));
  if (!result.success) throw new Error(`Invalid config in ${path}:\n${z.prettifyError(result.error)}`);
  return result.data;
}
