import { XMLParser } from "fast-xml-parser";
import { createHash } from "node:crypto";
import { getText, HttpError, htmlToText } from "../../http";
import type { Lead } from "../types";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const text = (v: unknown): string =>
  typeof v === "string" ? v : v && typeof v === "object" && "#text" in v ? String((v as { "#text": unknown })["#text"]) : "";

interface Entry {
  title?: unknown;
  link?: { "@_href"?: string } | { "@_href"?: string }[];
  updated?: string;
  published?: string;
  author?: { name?: string };
  content?: unknown;
  category?: { "@_term"?: string };
}

export function parseRedditFeed(xml: string): Lead[] {
  const feed = parser.parse(xml)?.feed;
  const entries: Entry[] = feed?.entry ? [].concat(feed.entry) : [];
  return entries.flatMap((e) => {
    const link = Array.isArray(e.link) ? e.link[0] : e.link;
    const url = link?.["@_href"];
    const title = htmlToText(text(e.title));
    if (!url || !title) return [];
    return [
      {
        id: createHash("sha1").update(`reddit:${url}`).digest("hex"),
        source: "reddit" as const,
        title,
        text: htmlToText(text(e.content)),
        url,
        postedAt: e.published ?? e.updated,
        origin: e.category?.["@_term"] ? `r/${e.category["@_term"]}` : undefined,
        author: e.author?.name?.replace(/^\/u\//, ""),
      },
    ];
  });
}

const GAP_MS = 15000;
let blocked = false;

/**
 * Reddit's keyword search feed over several subreddits at once (one request per query).
 * Reddit rate-limits quick bursts, so requests are spaced out and, once it says no,
 * the remaining queries in this run are skipped rather than hammering it.
 */
export async function searchReddit(subreddits: string[], query: string): Promise<Lead[]> {
  if (blocked) throw new Error("skipped: Reddit rate-limited this run");
  const params = new URLSearchParams({ q: query, restrict_sr: "1", sort: "new", t: "week" });
  const url = `https://www.reddit.com/r/${subreddits.map(encodeURIComponent).join("+")}/search.rss?${params}`;
  try {
    return parseRedditFeed(await getText(url));
  } catch (err) {
    if (err instanceof HttpError && (err.status === 429 || err.status === 403)) blocked = true;
    throw err;
  } finally {
    await sleep(GAP_MS);
  }
}

/** ["website", "landing page", "GTM"] → '"website" OR "landing page" OR "GTM"', in batches. */
export function batchQueries(queries: string[], perSearch: number): string[] {
  const batches: string[] = [];
  for (let i = 0; i < queries.length; i += perSearch) {
    batches.push(queries.slice(i, i + perSearch).map((q) => (/\s/.test(q) ? `"${q}"` : q)).join(" OR "));
  }
  return batches;
}
