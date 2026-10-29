import pLimit from "p-limit";
import { sendEmail } from "../email";
import { createStore } from "../store";
import { loadEvents } from "./config";
import { buildEventsDigest } from "./email";
import { confirmEventbrite, fetchEventbriteCity, fetchEventbriteOnline } from "./eventbrite";
import { buildEventMatcher, dedupeEvents } from "./filter";
import { fetchLuma } from "./luma";
import type { EventItem } from "./types";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const bootstrap = args.has("--bootstrap");

async function main() {
  const cfg = await loadEvents();
  const match = buildEventMatcher(cfg);
  const failures: string[] = [];
  const limit = pLimit(3);

  const run = (label: string, fn: () => Promise<EventItem[]>) =>
    limit(async () => {
      try {
        const events = await fn();
        console.log(`${label}: ${events.length} events`);
        return events;
      } catch (err) {
        failures.push(`${label} (${(err as Error).message})`);
        return [];
      }
    });

  const lumaTasks = cfg.cities.map((c) => run(`Luma ${c.name}`, () => fetchLuma(c, cfg)));
  const ebTasks = [
    ...cfg.cities.map((c) => run(`Eventbrite ${c.name}`, () => fetchEventbriteCity(c, cfg))),
    ...(cfg.virtual ? [run("Eventbrite online", () => fetchEventbriteOnline(cfg))] : []),
  ];

  const luma = (await Promise.all(lumaTasks)).flat().filter((e) => match(e));
  // Eventbrite lists don't show price or ticket status, so confirm each topic match on its own page.
  const ebCandidates = (await Promise.all(ebTasks)).flat().filter((e) => match(e));
  const eventbrite = await confirmEventbrite(ebCandidates, cfg.eventbrite.max_checks);
  console.log(`Eventbrite: ${ebCandidates.length} topic matches, ${eventbrite.length} free and on sale`);

  const matched = dedupeEvents([...luma, ...eventbrite]);

  const store = createStore("seen_events");
  if (!store && !dryRun) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  const seen = store ? await store.seenIds(matched.map((e) => e.id)) : new Set<string>();
  const fresh = matched.filter((e) => !seen.has(e.id));
  console.log(`${matched.length} matching, ${fresh.length} new, ${failures.length} failed`);
  for (const f of failures) console.log(`  failed: ${f}`);

  const rows = fresh.map((e) => ({ id: e.id, company: e.where, title: e.title, url: e.url, source: e.source }));

  if (dryRun) {
    const digest = buildEventsDigest(fresh, failures);
    console.log(fresh.length ? digest.text : "Nothing new; no email would be sent.");
    return;
  }
  if (bootstrap) {
    await store!.markSeen(rows);
    console.log(`Marked ${rows.length} events as seen; no email sent.`);
    return;
  }
  if (!fresh.length) return;

  // Send first, then record, so a failed send is retried on the next run.
  await sendEmail(buildEventsDigest(fresh, failures));
  await store!.markSeen(rows);
  console.log(`Emailed ${fresh.length} new events.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
