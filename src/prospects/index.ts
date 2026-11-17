import pLimit from "p-limit";
import { sendEmail } from "../email";
import { modeFrom, startRun } from "../runlog";
import { dropChains, loadProspectsConfig, planSearches } from "./config";
import { buildProspectsDigest } from "./email";
import { type Place, textSearch } from "./places";
import { checkSite, scoreProspect } from "./score";
import { createBudget, createProspectStore } from "./usage";

const argv = process.argv.slice(2);
const args = new Set(argv);
const dryRun = args.has("--dry-run");
const bootstrap = args.has("--bootstrap");
/** --requests N: use at most N requests this run (for testing). */
const run = startRun("prospects", modeFrom(args));
const requestsArg = argv.includes("--requests") ? Number(argv[argv.indexOf("--requests") + 1]) : undefined;

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function main() {
  const config = await loadProspectsConfig();
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY must be set");

  const store = createProspectStore();
  // Requests cost money past the free tier, so every run must be counted against the
  // monthly total in Supabase. The only exception is a tiny local dry run.
  if (!store && !(dryRun && requestsArg && requestsArg <= 3)) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (they track the Places API budget)");
  }

  const perRun = Math.min(config.budget.max_requests_per_run, requestsArg ?? Infinity);
  const usedThisMonth = store ? await store.used() : 0;
  const budget = createBudget({
    usedThisMonth,
    monthly: config.budget.max_requests_per_month,
    perRun,
    persist: async (total) => {
      if (store) await store.record(total);
    },
  });
  console.log(`Places budget: ${usedThisMonth} of ${config.budget.max_requests_per_month} used this month, up to ${perRun} this run.`);

  const failures: string[] = [];
  const found = new Map<string, Place & { city: string }>();
  for (const { query, city } of planSearches(config, perRun)) {
    if (!(await budget.reserve())) {
      console.log("Budget reached; stopping searches.");
      break;
    }
    const label = `"${query}" in ${city}`;
    try {
      const places = await textSearch(apiKey, `${query} in ${city}`, config.use_reviews);
      for (const p of places) if (!found.has(p.id)) found.set(p.id, { ...p, city });
      console.log(`${label}: ${places.length} places`);
    } catch (err) {
      console.warn(`${label}: FAILED — ${errorMessage(err)}`);
      failures.push(`${label} (${errorMessage(err)})`);
    }
  }
  run.failures = failures;
  run.counts = { requests: budget.runCount, used_this_month: budget.used, failed: failures.length };
  if (budget.runCount && failures.length === budget.runCount) throw new Error("Every Places search failed");

  const candidates = dropChains([...found.values()]).filter(
    (p) =>
      (!p.status || p.status === "OPERATIONAL") &&
      p.reviewCount >= config.min_reviews &&
      p.reviewCount <= config.max_reviews,
  );
  const seen = store ? await store.seenIds(candidates.map((p) => p.id)) : new Set<string>();
  const fresh = candidates.filter((p) => !seen.has(p.id));

  // Home pages are fetched directly (free); a handful at a time.
  const limit = pLimit(6);
  const scored = await Promise.all(
    fresh.map((p) =>
      limit(async () => ({ ...scoreProspect(p, p.website ? await checkSite(p.website) : null), city: p.city })),
    ),
  );
  const picked = scored
    .filter((p) => p.score >= config.min_score)
    .sort((a, b) => b.score - a.score || b.reviewCount - a.reviewCount)
    .slice(0, config.max_per_email);
  console.log(`\n${found.size} places, ${fresh.length} new and big enough, ${picked.length} worth emailing.`);
  Object.assign(run.counts, { places: found.size, new: fresh.length, picked: picked.length });

  if (bootstrap) {
    await store!.markSeen(picked.map((p) => p.id));
    console.log(`Bootstrap: marked ${picked.length} places as seen, no email sent.`);
    return;
  }

  const digest = buildProspectsDigest(picked, {
    requests: budget.runCount,
    usedThisMonth: budget.used,
    monthly: config.budget.max_requests_per_month,
    failures,
  });
  if (dryRun) {
    console.log(`\n--- dry run (nothing emailed; requests were still counted) ---\n${picked.length ? digest.text : "No prospects."}`);
    return;
  }
  if (!picked.length) {
    console.log("No new prospects; no email sent.");
    return;
  }
  await sendEmail(digest);
  await store!.markSeen(picked.map((p) => p.id));
  run.counts.emailed = picked.length;
  console.log(`Emailed ${picked.length} prospects.`);
}

main()
  .then(() => run.finish())
  .catch(async (err) => {
    console.error(errorMessage(err));
    await run.finish(err);
    process.exit(1);
  });
