import { XMLParser } from "fast-xml-parser";
import { getText, htmlToText } from "../http";

const parser = new XMLParser();

interface Item {
  title?: string;
  link?: string;
  pubDate?: string;
  source?: string | { "#text"?: string };
}

/** A funding story from Google News. */
export interface NewsItem {
  title: string;
  url: string;
  postedAt?: string;
  outlet?: string;
}

/** A company found in a funding story. */
export interface FundedCompany {
  name: string;
  /** The headline it came from, and its link. */
  headline: string;
  url: string;
  postedAt?: string;
}

const VERBS = /\s+(?:raises?|raised|bags|secures?|secured|closes|closed|lands|gets|announces|picks up|nets|mops up)\b/i;

/** Words that describe a company rather than name it: "Bengaluru-based fintech startup Acme". */
const DESCRIPTOR =
  /^(?:startups?|start-ups?|brands?|company|companies|firm|platform|marketplace|unicorn|maker|player|provider|app|venture|label|fintech|edtech|healthtech|agritech|insurtech|proptech|deeptech|spacetech|cleantech|climatetech|legaltech|martech|foodtech|traveltech|saas|d2c|dtc|b2b|b2c|ecommerce|e-commerce|[\w-]+-(?:based|backed|focused|led|first|owned)|[\w-]+['’]s)$/i;

/** Names that are too common to search for on LinkedIn without drowning in other people. */
const GENERIC = new Set(["india", "indian", "the", "this", "startup", "exclusive", "funding", "report", "news", "tech", "ai"]);

/**
 * The company a funding headline is about: the words before the funding verb, after the last
 * descriptor ("Child-care startup Maasi raises…" → "Maasi", "From Rishikesh rafting to Manali:
 * Bucketlistt raises…" → "Bucketlistt"). Null when no plausible name is found.
 */
export function companyFromHeadline(title: string): string | null {
  const m = title.match(new RegExp(`^(.*?)${VERBS.source}`, "i"));
  if (!m) return null;
  // Anything before a colon is a lead-in ("Exclusive:", "From X to Y:").
  const before = m[1].split(/:\s+/).pop()!.replace(/^\[[^\]]*\]\s*/, "").trim();
  const words = before.split(/\s+/).filter(Boolean);
  let start = 0;
  words.forEach((w, i) => {
    if (DESCRIPTOR.test(w.replace(/,+$/, ""))) start = i + 1;
  });
  // Lower-case words left over are a description, not a name ("rafting app Acme").
  let name = words.slice(start);
  for (let i = name.length - 1; i >= 0; i--)
    // "altM" and "mistEO" are names despite the lower-case start.
    if (/^[a-z]/.test(name[i]) && !/^[a-z]+[A-Z]/.test(name[i])) {
      name = name.slice(i + 1);
      break;
    }
  const joined = name
    .join(" ")
    .replace(/[’']s$/i, "")
    .replace(/\.(?:com|in|ai|io|co|app)$/i, "")
    .replace(/^[^\w]+|[^\w)]+$/g, "")
    .trim();
  if (joined.length < 3 || name.length > 4 || GENERIC.has(joined.toLowerCase())) return null;
  return joined;
}

export function parseNewsFeed(xml: string): NewsItem[] {
  const raw = parser.parse(xml)?.rss?.channel?.item;
  const items: Item[] = raw ? [].concat(raw) : [];
  return items.flatMap((i) => {
    if (!i.title || !i.link) return [];
    const outlet = typeof i.source === "object" ? i.source["#text"] : i.source;
    // Google News appends " - Outlet" to every headline.
    const title = htmlToText(String(i.title)).replace(/\s+-\s+[^-]+$/, "");
    return [{ title, url: String(i.link), postedAt: i.pubDate ? new Date(i.pubDate).toISOString() : undefined, outlet }];
  });
}

/** Funding announcements from Google News search, e.g. "Seed round" stories about Indian startups. */
export async function searchFunding(query: string, days: number): Promise<NewsItem[]> {
  const params = new URLSearchParams({ q: `${query} when:${days}d`, hl: "en-IN", gl: "IN", ceid: "IN:en" });
  return parseNewsFeed(await getText(`https://news.google.com/rss/search?${params}`));
}

/** One entry per company, newest story first; several outlets report the same round. */
export function companiesFromNews(items: NewsItem[]): FundedCompany[] {
  const byName = new Map<string, FundedCompany>();
  const sorted = [...items].sort((a, b) => Date.parse(b.postedAt ?? "0") - Date.parse(a.postedAt ?? "0"));
  for (const item of sorted) {
    const name = companyFromHeadline(item.title);
    if (!name) continue;
    const key = companyKey(name);
    if (!byName.has(key)) byName.set(key, { name, headline: item.title, url: item.url, postedAt: item.postedAt });
  }
  return [...byName.values()];
}

/** "Acme Pay", "ACME PAY" and "Acme-Pay" are one company. */
export const companyKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");
