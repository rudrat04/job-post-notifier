import { XMLParser } from "fast-xml-parser";
import { createHash } from "node:crypto";
import { getJson, getText, HttpError, htmlToText, request } from "../../http";
import type { Lead } from "../types";

/** One id per Reddit post however its link is written, so the RSS and web-search sources don't double up. */
export function redditLeadId(url: string): string {
  const post = url.match(/\/comments\/([a-z0-9]+)/i)?.[1];
  return createHash("sha1").update(`reddit:${post ?? url}`).digest("hex");
}

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
        id: redditLeadId(url),
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

interface Child {
  data: {
    id: string;
    title: string;
    selftext?: string;
    permalink: string;
    created_utc: number;
    subreddit?: string;
    author?: string;
  };
}

export function parseRedditJson(data: { data?: { children?: Child[] } }): Lead[] {
  return (data.data?.children ?? []).map(({ data: p }) => {
    const url = `https://www.reddit.com${p.permalink}`;
    return {
      id: redditLeadId(url),
      source: "reddit" as const,
      title: htmlToText(p.title),
      text: htmlToText(p.selftext ?? ""),
      url,
      postedAt: new Date(p.created_utc * 1000).toISOString(),
      origin: p.subreddit ? `r/${p.subreddit}` : undefined,
      author: p.author,
    };
  });
}

const APP_UA = "script:job-post-notifier:0.2 (personal lead alerts)";
let token: Promise<string> | null = null;

/** App-only OAuth token for a Reddit "script" app (REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET). */
function appToken(id: string, secret: string): Promise<string> {
  token ??= request("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": APP_UA,
    },
    body: "grant_type=client_credentials",
  })
    .then((r) => r.json() as Promise<{ access_token?: string }>)
    .then((d) => {
      if (!d.access_token) throw new Error("Reddit gave no access token; check REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET");
      return d.access_token;
    });
  return token;
}

/**
 * Reddit's keyword search feed over several subreddits at once (one request per query).
 * Reddit rate-limits quick bursts, so requests are spaced out and, once it says no,
 * the remaining queries in this run are skipped rather than hammering it.
 */
export async function searchReddit(
  subreddits: string[],
  query: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Lead[]> {
  if (blocked) throw new Error("skipped: Reddit rate-limited this run");
  const params = new URLSearchParams({ q: query, restrict_sr: "1", sort: "new", t: "week" });
  const subs = subreddits.map(encodeURIComponent).join("+");
  const { REDDIT_CLIENT_ID: id, REDDIT_CLIENT_SECRET: secret } = env;
  try {
    if (id && secret) {
      params.set("limit", "100");
      const data = await getJson<{ data?: { children?: Child[] } }>(`https://oauth.reddit.com/r/${subs}/search?${params}`, {
        headers: { authorization: `Bearer ${await appToken(id, secret)}`, "user-agent": APP_UA },
      });
      return parseRedditJson(data);
    }
    return parseRedditFeed(await getText(`https://www.reddit.com/r/${subs}/search.rss?${params}`));
  } catch (err) {
    if (err instanceof HttpError && (err.status === 429 || err.status === 403)) blocked = true;
    throw err;
  } finally {
    // The app key allows ~100 requests a minute; the public feed needs long gaps.
    await sleep(id && secret ? 1000 : GAP_MS);
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
