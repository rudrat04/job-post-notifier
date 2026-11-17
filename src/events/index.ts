import pLimit from "p-limit";
import { sendEmail } from "../email";
import { modeFrom, startRun } from "../runlog";
import { createStore } from "../store";
import { loadEvents } from "./config";
import { buildEventsDigest } from "./email";
import { buildEventMatcher, dedupeEvents } from "./filter";
import { fetchLuma } from "./luma";
import { fetchMeetupOnline } from "./meetup";
import type { EventItem } from "./types";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const bootstrap = args.has("--bootstrap");
// With --dry-run, also list events that were already emailed.
const includeSeen = args.has("--all");
const runLog = startRun("events", modeFrom(args));

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
        console.warn(`${label}: FAILED — ${(err as Error).message}`);
        failures.push(`${label} (${(err as Error).message})`);
        return [];
      }
    });

  const tasks = [
    ...cfg.cities.map((c) => run(`Luma ${c.name}`, () => fetchLuma(c, cfg))),
    ...(cfg.virtual ? cfg.meetup.online_queries.map((q) => run(`Meetup online "${q}"`, () => fetchMeetupOnline(q))) : []),
  ];
  const results = await Promise.all(tasks);
  runLog.failures = failures;
  runLog.counts = { sources: tasks.length, failed: failures.length };
  // Without this, a broken API would look like a quiet week: no email and a green run.
  if (tasks.length && failures.length === tasks.length) throw new Error("Every event source failed");
  const found = results.flat().map(match.markBig).filter((e) => match(e));

  const matched = dedupeEvents(found);

  const store = createStore("seen_events");
  if (!store && !dryRun) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  const seen = store ? await store.seenIds(matched.map((e) => e.id)) : new Set<string>();
  const fresh = matched.filter((e) => (dryRun && includeSeen) || !seen.has(e.id));
  console.log(`${matched.length} matching, ${fresh.length} new, ${failures.length} failed`);
  Object.assign(runLog.counts, { matching: matched.length, new: fresh.length });

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
  if (!fresh.length) {
    console.log("No new events; no email sent.");
    return;
  }

  // Send first, then record, so a failed send is retried on the next run.
  await sendEmail(buildEventsDigest(fresh, failures));
  await store!.markSeen(rows);
  runLog.counts.emailed = fresh.length;
  console.log(`Emailed ${fresh.length} new events.`);
}

main()
  .then(() => runLog.finish())
  .catch(async (err) => {
    console.error(err);
    await runLog.finish(err);
    process.exit(1);
  });
