import { createHash } from "node:crypto";
import { htmlToText, request } from "../../http";
import type { Lead } from "../types";
import { redditLeadId } from "./reddit";

type Platform = "reddit" | "x" | "linkedin";

export const SITE: Record<Platform, string> = {
  reddit: "reddit.com",
  x: "x.com",
  linkedin: "linkedin.com/posts",
};

/** Result links that are an actual post, as opposed to a profile, subreddit or wiki page. */
const POST_URL: Record<Platform, RegExp> = {
  reddit: /reddit\.com\/r\/[^/]+\/comments\/[a-z0-9]+/i,
  x: /(?:x|twitter)\.com\/[^/]+\/status\/\d+/i,
  linkedin: /linkedin\.com\/(?:posts\/|feed\/update\/)/i,
};

const quote = (w: string) => (/[\s'-]/.test(w) ? `"${w}"` : w);
const orList = (words: string[]) => `(${words.map(quote).join(" OR ")})`;

/** site:reddit.com ("looking for" OR seeking) (website OR "landing page") */
export function buildQuery(platform: Platform, asks: string[], group: string[]): string {
  const site = platform === "x" ? "(site:x.com OR site:twitter.com)" : `site:${SITE[platform]}`;
  return `${site} ${orList(asks)} ${orList(group)}`;
}

/** "3 hours ago" / "2 days ago" / "Oct 26, 2026" → ISO date, or undefined if it can't be read. */
export function parseResultDate(text: string | undefined, now = Date.now()): string | undefined {
  if (!text) return undefined;
  const rel = text.match(/(\d+)\s*(minute|hour|day|week|month)s?\s+ago/i);
  if (rel) {
    const unit = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_592_000_000 }[
      rel[2].toLowerCase() as "minute"
    ];
    return new Date(now - Number(rel[1]) * unit).toISOString();
  }
  const abs = Date.parse(text);
  return Number.isNaN(abs) ? undefined : new Date(abs).toISOString();
}

export interface SearchResult {
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
}

/**
 * Google's snippet for a Reddit thread often continues with text from other threads
 * ("... · r/Wordpress • 9mo ago ..."), and LinkedIn's ends with "| 119 comments". Keep only
 * the post's own text so other people's requests don't make this post look like one.
 */
export function ownText(snippet: string): string {
  // Reddit snippets also run on into the "related posts" sidebar, which shows up as vote
  // and comment counts ("Paid work]. 47. 122. Looking for…") or a count before "...".
  return snippet
    .split(/\s+[·•]\s+|\s+\|\s+\d+\s+(?:comments?|reactions?|likes?)\b|\.\s+\d+\.\s+\d+\.|\s\d+\s+\.\.\.\s/i)[0]
    .trim();
}

function leadFrom(platform: Platform, r: SearchResult, now: number): Lead | null {
  if (!r.link || !r.title || !POST_URL[platform].test(r.link)) return null;
  // LinkedIn post links carry the post's hashtags ("..._hiring-salesjobs-activity-…"), so job ads show in the URL.
  if (platform === "linkedin" && /[_-](?:now)?hiring|jobs?[-_]|careers|internships?/i.test(r.link)) return null;
  const url = r.link.split("?")[0];
  const key = platform === "x" ? url.match(/status\/(\d+)/)![1] : url;
  return {
    id: platform === "reddit" ? redditLeadId(url) : createHash("sha1").update(`${platform}:${key}`).digest("hex"),
    source: platform,
    title: htmlToText(r.title).replace(/\s*:\s*r\/\w+$/, ""),
    text: ownText(htmlToText(r.snippet ?? "")),
    url,
    postedAt: parseResultDate(r.date, now),
    origin: platform === "reddit" ? url.match(/\/r\/([^/]+)/)?.[0].replace(/^\//, "") : undefined,
  };
}

/** Both search APIs bill per request, so a failed one is never retried. */
async function getPaidJson<T>(url: string, init?: RequestInit): Promise<T> {
  return (await request(url, init, 0)).json() as Promise<T>;
}

/** Serper (Google results). One credit per search. */
async function viaSerper(key: string, q: string, days: number | undefined, num: number): Promise<SearchResult[]> {
  const data = await getPaidJson<{ organic?: SearchResult[] }>("https://google.serper.dev/search", {
    method: "POST",
    headers: { "x-api-key": key, "content-type": "application/json" },
    // Free Serper accounts reject more than 10 results per search.
    body: JSON.stringify({ q, num: Math.min(num, 10), ...(days ? { tbs: `qdr:d${days}` } : {}), gl: "in", hl: "en" }),
  });
  return data.organic ?? [];
}

/** SerpApi, used when Serper fails or has no key. */
async function viaSerpApi(key: string, q: string, days: number | undefined, num: number): Promise<SearchResult[]> {
  const params = new URLSearchParams({ engine: "google", q, num: String(num), gl: "in", hl: "en", api_key: key });
  if (days) params.set("tbs", `qdr:d${days}`);
  const data = await getPaidJson<{ organic_results?: SearchResult[]; error?: string }>(`https://serpapi.com/search.json?${params}`);
  if (data.error && /hasn't returned any results/i.test(data.error)) return [];
  if (data.error) throw new Error(`SerpApi: ${data.error}`);
  return data.organic_results ?? [];
}

export function hasSearchKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.SERPER_API_KEY || env.SERPAPI_KEY);
}

/** Google results through Serper, falling back to SerpApi. `days` limits results to the last N days. */
export async function googleSearch(
  query: string,
  days: number | undefined,
  num: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SearchResult[]> {
  try {
    if (!env.SERPER_API_KEY) throw new Error("no Serper key");
    return await viaSerper(env.SERPER_API_KEY, query, days, num);
  } catch (err) {
    if (!env.SERPAPI_KEY) throw err;
    try {
      return await viaSerpApi(env.SERPAPI_KEY, query, days, num);
    } catch (fallbackErr) {
      throw new Error(`${(err as Error).message}; then ${(fallbackErr as Error).message}`);
    }
  }
}

export async function searchWeb(
  platform: Platform,
  query: string,
  days: number,
  num: number,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): Promise<Lead[]> {
  const results = await googleSearch(query, days, num, env);
  return results.flatMap((r) => leadFrom(platform, r, now) ?? []);
}
