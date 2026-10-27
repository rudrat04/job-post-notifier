import pLimit from "p-limit";
import { sendEmail } from "../email";
import { createStore } from "../store";
import { loadLeadsConfig } from "./config";
import { buildLeadsDigest } from "./email";
import { buildLeadMatcher } from "./filter";
import { searchFreelancer } from "./sources/freelancer";
import { dedupeFunding, searchFunding } from "./sources/funding";
import { searchHackerNews } from "./sources/hackernews";
import { batchQueries, searchReddit } from "./sources/reddit";
import { buildQuery, hasSearchKey, searchWeb } from "./sources/websearch";
import type { Lead } from "./types";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const bootstrap = args.has("--bootstrap");
const testEmail = args.has("--test-email");

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function main() {
  const config = await loadLeadsConfig();
  // Nothing runs on weekends, so Monday has to look back over Saturday and Sunday too.
  const isMonday = new Date().getUTCDay() === 1;
  const windowDays = isMonday ? Math.max(3, config.max_age_days) : config.max_age_days;
  config.max_age_days = windowDays;
  const match = buildLeadMatcher(config);
  const failures: string[] = [];
  const limit = pLimit(4);
  const redditLimit = pLimit(1); // Reddit gets one request at a time.

  const task = (label: string, run: () => Promise<Lead[]>, gate = limit) =>
    gate(async () => {
      try {
        const leads = await run();
        const kept = leads.filter((l) => match(l));
        console.log(`${label}: ${leads.length} results, ${kept.length} match`);
        return kept;
      } catch (err) {
        console.warn(`${label}: FAILED — ${errorMessage(err)}`);
        failures.push(`${label} (${errorMessage(err)})`);
        return [];
      }
    });

  const tasks: Promise<Lead[]>[] = [];
  const { reddit, hackernews, freelancer, funding } = config;
  for (const q of batchQueries(reddit?.queries ?? [], reddit?.queries_per_search ?? 12))
    tasks.push(task(`Reddit ${q}`, () => searchReddit(reddit!.subreddits, q), redditLimit));
  for (const q of hackernews?.queries ?? [])
    tasks.push(task(`Hacker News "${q}"`, () => searchHackerNews(q, config.max_age_days)));
  for (const q of freelancer?.queries ?? [])
    tasks.push(
      task(`Freelancer "${q}"`, () =>
        searchFreelancer(q, config.max_age_days, { minBudgetUsd: freelancer!.min_budget_usd, maxBids: freelancer!.max_bids }),
      ),
    );

  const web = config.web_search;
  if (web && !hasSearchKey()) console.warn("Skipping web search (set SERPER_API_KEY or SERPAPI_KEY)");
  if (web && hasSearchKey()) {
    const queries = web.platforms.flatMap((platform) =>
      web.groups.map((group) => ({ platform, group, q: buildQuery(platform, web.asks, group) })),
    );
    for (const { platform, group, q } of queries.slice(0, web.max_queries))
      tasks.push(
        task(`Web ${platform} [${group.slice(0, 3).join(", ")}…]`, () =>
          searchWeb(platform, q, Math.ceil(windowDays), web.results_per_query),
        ),
      );
    if (queries.length > web.max_queries) console.warn(`Web search capped at ${web.max_queries} of ${queries.length} queries`);
  }

  const fundingKeywords = new RegExp(`(?:${(funding?.keywords ?? []).join("|")})`, "i");
  const fundingTasks = (funding?.queries ?? []).map((q) =>
    task(`Funding "${q}"`, async () => (await searchFunding(q)).filter((l) => fundingKeywords.test(l.title))),
  );

  const [general, fundingLeads] = await Promise.all([Promise.all(tasks), Promise.all(fundingTasks)]);
  const attempted = tasks.length + fundingTasks.length;
  if (attempted && failures.length === attempted) throw new Error("Every lead source failed");

  const unique = (leads: Lead[]) => [...new Map(leads.map((l) => [l.id, l])).values()];
  const marketplace = unique(general.flat());
  const all = [
    ...marketplace.filter((l) => l.source !== "freelancer"),
    ...marketplace.filter((l) => l.source === "freelancer").slice(0, freelancer?.max_per_run),
    ...dedupeFunding(unique(fundingLeads.flat())).slice(0, funding?.max_per_run),
  ];

  const store = createStore("seen_leads");
  if (!store && !dryRun) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  const seen = store ? await store.seenIds(all.map((l) => l.id)) : new Set<string>();
  const fresh = all.filter((l) => !seen.has(l.id));
  console.log(`\n${all.length} matching, ${fresh.length} new, ${failures.length} failed`);

  const rows = (leads: Lead[]) =>
    leads.map((l) => ({ id: l.id, company: l.origin ?? l.source, title: l.title, url: l.url, source: l.source }));

  if (bootstrap) {
    await store!.markSeen(rows(fresh));
    console.log(`Bootstrap: marked ${fresh.length} leads as seen, no email sent.`);
    return;
  }

  const digest = buildLeadsDigest(fresh, failures);
  if (dryRun) {
    console.log(`\n--- dry run (nothing sent or saved) ---\n${fresh.length ? digest.text : "No new leads."}`);
    return;
  }
  if (testEmail) {
    // Sends the real digest to EMAIL_TO but records nothing, so these leads still arrive in the next real run.
    await sendEmail({ ...digest, subject: `[TEST] ${digest.subject}` });
    console.log(`Test email sent with ${fresh.length} leads; nothing was saved.`);
    return;
  }
  if (!fresh.length) {
    console.log("No new leads; no email sent.");
    return;
  }
  await sendEmail(digest); // send first, then record, so a failed send is retried next run
  await store!.markSeen(rows(fresh));
  console.log(`Emailed ${fresh.length} new leads.`);
}

main().catch((err) => {
  console.error(errorMessage(err));
  process.exit(1);
});
