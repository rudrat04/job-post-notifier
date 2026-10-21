import type { SearchConfig } from "../config";
import type { Job } from "../types";
import { searchAdzuna, searchJooble, searchJSearch } from "./aggregators";
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
): { tasks: SearchTask[]; skipped: string[] } {
  const tasks: SearchTask[] = [];
  const skipped: string[] = [];

  for (const location of search.workable?.locations ?? []) {
    for (const q of search.queries) {
      tasks.push({ label: `Workable "${q}" in ${location}`, run: () => searchWorkable(q, location, dayRange) });
    }
  }

  if (search.adzuna) {
    const { ADZUNA_APP_ID: appId, ADZUNA_APP_KEY: appKey } = env;
    if (!appId || !appKey) skipped.push("Adzuna (set ADZUNA_APP_ID and ADZUNA_APP_KEY)");
    else
      for (const where of search.adzuna.where)
        for (const q of search.queries)
          tasks.push({
            label: `Adzuna "${q}" in ${where}`,
            run: () => searchAdzuna({ appId, appKey }, q, where, dayRange),
          });
  }

  if (search.jooble) {
    const key = env.JOOBLE_API_KEY;
    if (!key) skipped.push("Jooble (set JOOBLE_API_KEY)");
    else
      for (const where of search.jooble.where)
        for (const q of search.queries)
          tasks.push({ label: `Jooble "${q}" in ${where}`, run: () => searchJooble(key, q, where, dayRange) });
  }

  if (search.jsearch) {
    const key = env.RAPIDAPI_KEY;
    if (!key) skipped.push("JSearch (set RAPIDAPI_KEY)");
    else {
      const all = search.jsearch.where.flatMap((where) => search.jsearch!.queries.map((q) => ({ q, where })));
      for (const { q, where } of all.slice(0, search.jsearch.max_requests))
        tasks.push({ label: `JSearch "${q}" in ${where}`, run: () => searchJSearch(key, q, where, dayRange) });
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
