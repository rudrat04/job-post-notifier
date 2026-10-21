import pLimit from "p-limit";
import { loadCompanies, loadFilters } from "./config";
import { resolveCompany } from "./detect";
import { buildDigest, sendEmail } from "./email";
import { buildMatcher } from "./filter";
import { fetchJobs } from "./sources";
import { createStore } from "./store";
import type { Job, MatchedJob, SourceFailure } from "./types";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const bootstrap = args.has("--bootstrap");

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function main() {
  const [{ companies }, filters] = await Promise.all([loadCompanies(), loadFilters()]);
  const match = buildMatcher(filters);
  const limit = pLimit(5);
  const failures: SourceFailure[] = [];

  const perCompany = await Promise.all(
    companies.map((entry) =>
      limit(async () => {
        const label = entry.name ?? entry.url;
        try {
          const company = await resolveCompany(entry);
          const jobs = await fetchJobs(company);
          const matched = jobs.map(match).filter((j): j is MatchedJob => j !== null);
          console.log(`${company.name} [${company.ats}/${company.slug}]: ${jobs.length} jobs, ${matched.length} match`);
          return matched;
        } catch (err) {
          console.warn(`${label}: FAILED — ${errorMessage(err)}`);
          failures.push({ company: label, url: entry.url, reason: errorMessage(err) });
          return [];
        }
      }),
    ),
  );

  if (failures.length === companies.length) throw new Error("Every company failed to load");

  // The same posting can appear twice if a company is listed twice.
  const matched = [...new Map(perCompany.flat().map((j) => [j.id, j])).values()];

  const store = createStore();
  if (!store && !dryRun) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");

  const seen = store ? await store.seenIds(matched.map((j) => j.id)) : new Set<string>();
  const fresh = matched.filter((j) => !seen.has(j.id));
  console.log(`\n${matched.length} matching, ${fresh.length} new, ${failures.length} failed`);

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
