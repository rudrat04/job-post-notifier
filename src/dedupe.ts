import { createHash } from "node:crypto";
import type { Job, Source } from "./types";

const COMPANY_SUFFIXES = /\b(?:pvt|private|ltd|limited|inc|llc|llp|corp|corporation|co|technologies|technology|india)\b/g;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&amp;?/g, "&")
    .replace(/[^a-z0-9&\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * One id per (company, title), whichever site the job was found on, so a role
 * seen on its employer's board and again on an aggregator is only emailed once.
 */
export function contentId(company: string, title: string): string {
  const c = norm(company).replace(COMPANY_SUFFIXES, "").replace(/\s+/g, " ").trim();
  return createHash("sha1").update(`${c}|${norm(title)}`).digest("hex");
}

const AGGREGATORS: Source[] = ["jsearch", "jobspy"];

/** Collapses duplicate jobs, joining their locations and preferring the employer's own link. */
export function mergeDuplicates<T extends Job>(jobs: T[]): T[] {
  const byId = new Map<string, T>();
  for (const job of jobs) {
    const cur = byId.get(job.id);
    if (!cur) {
      byId.set(job.id, { ...job });
      continue;
    }
    const locations = [...new Set([...cur.location.split(" / "), ...job.location.split(" / ")].filter(Boolean))];
    const better = AGGREGATORS.includes(cur.source) && !AGGREGATORS.includes(job.source) ? job : cur;
    const merged: T = {
      ...cur,
      url: better.url,
      source: better.source,
      location: locations.join(" / "),
      remote: cur.remote || job.remote,
      postedAt: cur.postedAt ?? job.postedAt,
    };
    // One copy may have had no location while another did; don't flag the merged job.
    if ("locationMissing" in merged) Object.assign(merged, { locationMissing: !merged.location.trim() });
    byId.set(job.id, merged);
  }
  return [...byId.values()];
}
