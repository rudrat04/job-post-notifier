import pLimit from "p-limit";
import { loadCompanies, loadDiscovered, loadFilters, loadSearch } from "./config";
import { resolveCompany } from "./detect";
import { buildDigest, sendEmail } from "./email";
import { buildMatcher } from "./filter";
import { fetchJobs } from "./sources";
import { findJobspy } from "./sources/jobspy";
import { planSearches } from "./sources/search";
import { contentId, mergeDuplicates } from "./dedupe";
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
  const limit = pLimit(6);
  const scraperLimit = pLimit(2);
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

  const jobspyBin = search?.jobspy ? await findJobspy() : null;
  const { tasks, skipped } = search
    ? planSearches(search, filters.max_age_days, process.env, jobspyBin)
    : { tasks: [], skipped: [] };
  for (const name of skipped) console.warn(`Skipping ${name}`);

  const fromSearch = tasks.map((task) =>
    (task.group === "jobspy" ? scraperLimit : limit)(async () => {
      try {
        const jobs = await task.run();
        const matched = jobs.map((j) => match(j)).filter((j): j is MatchedJob => j !== null);
        console.log(`${task.label}: ${jobs.length} results, ${matched.length} match`);
        return matched;
      } catch (err) {
        console.warn(`${task.label}: FAILED — ${errorMessage(err)}`);
        failures.push({ company: task.label, url: "", reason: errorMessage(err) });
        return [];
      }
    }),
  );

  const results = await Promise.all([...fromCompanies, ...fromSearch]);
  if (failures.length === results.length) throw new Error("Every source failed to load");
  console.log(`\nChecked ${checked} company boards and ${tasks.length} searches.`);

  // The same role is often found on several sites; give each one id per company + title and merge them.
  const matched = mergeDuplicates(results.flat().map((j) => ({ ...j, id: contentId(j.company, j.title) })));

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
