import type { SearchConfig } from "../config";
import type { Job } from "../types";
import { searchJSearch } from "./aggregators";
import { searchJobspy } from "./jobspy";
import { searchWorkable } from "./workable-search";

export interface SearchTask {
  label: string;
  /** Scraper runs are slow and easily rate-limited, so they get a lower concurrency. */
  group?: "jobspy";
  run: () => Promise<Job[]>;
}

/**
 * Expands the search config into one task per (source, query, place). A source
 * whose API key is missing is skipped and named in `skipped`.
 */
export function planSearches(
  search: SearchConfig,
  dayRange: number,
  env: NodeJS.ProcessEnv = process.env,
  jobspyBin: string | null = null,
  opts: { jsearch?: boolean; now?: number } = {},
): { tasks: SearchTask[]; skipped: string[] } {
  const tasks: SearchTask[] = [];
  const skipped: string[] = [];

  for (const location of search.workable?.locations ?? []) {
    for (const q of search.queries) {
      tasks.push({ label: `Workable "${q}" in ${location}`, run: () => searchWorkable(q, location, dayRange) });
    }
  }

  if (search.jsearch) {
    const key = env.RAPIDAPI_KEY;
    if (!key) skipped.push("JSearch (set RAPIDAPI_KEY)");
    else if (opts.jsearch === false) skipped.push("JSearch (only runs on normal runs, to save the monthly quota)");
    else {
      // Each run takes the next few (query, place) pairs, so every pair gets its turn
      // while a run never spends more than max_requests of the monthly quota.
      const all = search.jsearch.where.flatMap((where) => search.jsearch!.queries.map((q) => ({ q, where })));
      const count = Math.min(search.jsearch.max_requests, all.length);
      const slot = Math.floor((opts.now ?? Date.now()) / (12 * 3_600_000)); // one slot per half day
      const start = (slot * count) % all.length;
      for (let i = 0; i < count; i++) {
        const { q, where } = all[(start + i) % all.length];
        tasks.push({ label: `JSearch "${q}" in ${where}`, run: () => searchJSearch(key, q, where, dayRange) });
      }
    }
  }

  if (search.jobspy) {
    const js = search.jobspy;
    if (!jobspyBin) skipped.push("JobSpy (pip install python-jobspy==1.4.0)");
    else {
      const places = [
        ...js.where.map((where) => ({ where, remote: false })),
        ...(js.remote_india ? [{ where: "India", remote: true }] : []),
      ];
      for (const { where, remote } of places)
        for (const q of js.queries)
          tasks.push({
            label: `JobSpy "${q}" in ${where}${remote ? " (remote)" : ""}`,
            group: "jobspy",
            run: () =>
              searchJobspy(jobspyBin, {
                sites: js.sites,
                query: q,
                where,
                remote,
                hoursOld: Math.ceil(dayRange * 24),
                results: js.results_per_site,
              }),
          });
    }
  }

  return { tasks, skipped };
}
