import pLimit from "p-limit";
import { loadCompanies, loadDiscovered, loadFilters, loadSearch } from "./config";
import { resolveCompany } from "./detect";
import { buildDigest, sendEmail } from "./email";
import { buildMatcher } from "./filter";
import { fetchJobs } from "./sources";
import { searchWorkable } from "./sources/workable-search";
import { createStore } from "./store";
import type { Job, MatchedJob, SourceFailure } from "./types";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const bootstrap = args.has("--bootstrap");

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function main() {
  const [manual, discovered, filters, search] = await Promise.all([
    loadCompanies(),
    loadDiscovered(),
    loadFilters(),
    loadSearch(),
  ]);
  const companies = [...manual.companies, ...discovered.companies];
  const match = buildMatcher(filters);
  const limit = pLimit(8);
  const failures: SourceFailure[] = [];
  let checked = 0;

  const fromCompanies = companies.map((entry) =>
    limit(async () => {
      const label = entry.name ?? entry.url;
      try {
        const company = await resolveCompany(entry);
        const jobs = await fetchJobs(company);
        checked++;
        const matched = jobs.map((j) => match(j)).filter((j): j is MatchedJob => j !== null);
        if (matched.length) console.log(`${company.name} [${company.ats}/${company.slug}]: ${jobs.length} jobs, ${matched.length} match`);
        return matched;
      } catch (err) {
        console.warn(`${label}: FAILED — ${errorMessage(err)}`);
        failures.push({ company: label, url: entry.url, reason: errorMessage(err) });
        return [];
      }
    }),
  );

  const fromSearch = (search?.queries ?? []).flatMap((query) =>
    search!.locations.map((location) =>
      limit(async () => {
        try {
          const jobs = await searchWorkable(query, location, filters.max_age_days);
          const matched = jobs.map((j) => match(j)).filter((j): j is MatchedJob => j !== null);
          console.log(`Workable search "${query}" in ${location}: ${jobs.length} results, ${matched.length} match`);
          return matched;
        } catch (err) {
          console.warn(`Workable search "${query}": FAILED — ${errorMessage(err)}`);
          failures.push({ company: `Workable search "${query}"`, url: "", reason: errorMessage(err) });
          return [];
        }
      }),
    ),
  );

  const results = await Promise.all([...fromCompanies, ...fromSearch]);
  if (failures.length === results.length) throw new Error("Every source failed to load");
  console.log(`\nChecked ${checked} company boards and ${fromSearch.length} searches.`);

  // The same posting can appear twice (a company listed twice, or found by two searches).
  const matched = [...new Map(results.flat().map((j) => [j.id, j])).values()];

  const store = createStore();
  if (!store && !dryRun) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");

  const seen = store ? await store.seenIds(matched.map((j) => j.id)) : new Set<string>();
  const fresh = matched.filter((j) => !seen.has(j.id));
  console.log(`${matched.length} matching, ${fresh.length} new, ${failures.length} failed`);

  if (bootstrap) {
    await store!.markSeen(fresh);
    console.log(`Bootstrap: marked ${fresh.length} jobs as seen, no email sent.`);
    return;
  }

  const digest = buildDigest(fresh, failures);
  if (dryRun) {
    console.log(`\n--- dry run (nothing sent or saved) ---\n${fresh.length ? digest.text : "No new jobs."}`);
    return;
  }

  if (!fresh.length) {
    console.log("No new jobs; no email sent.");
    return;
  }
  // Send first, then record, so a failed send is retried on the next run.
  await sendEmail(digest);
  await store!.markSeen(fresh as Job[]);
  console.log(`Emailed ${fresh.length} new jobs.`);
}

main().catch((err) => {
  console.error(errorMessage(err));
  process.exit(1);
});
