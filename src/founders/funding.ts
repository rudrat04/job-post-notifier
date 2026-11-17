import { XMLParser } from "fast-xml-parser";
import { createHash } from "node:crypto";
import { getText, htmlToText } from "../../http";
import type { Lead } from "../types";

const parser = new XMLParser();

interface Item {
  title?: string;
  link?: string;
  pubDate?: string;
  source?: string | { "#text"?: string };
}

const VERBS = /\s+(?:raises?|bags|secures?|closes|lands|gets|announces)\b/i;
const GENERIC = new Set(["startup", "tech", "labs", "india", "pvt", "ltd", "technologies", "platform", "company", "ai"]);

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/\.(?:com|in|ai|io|co)\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Name before the funding verb: "Child-care startup Maasi raises…" → ["child", "care", "startup", "maasi"]. */
function subject(title: string): string[] {
  const m = title.match(new RegExp(`^(.*?)${VERBS.source}`, "i"));
  return words(m?.[1] ?? title);
}

/** Collapses the same round reported by several outlets: one lead per company, first (newest) kept. */
export function dedupeFunding(leads: Lead[]): Lead[] {
  const kept: { lead: Lead; subject: string[] }[] = [];
  for (const lead of leads) {
    const subj = subject(lead.title);
    const key = subj[subj.length - 1];
    const dup = kept.some((k) => {
      const other = k.subject[k.subject.length - 1];
      const usable = (w?: string) => w && w.length >= 4 && !GENERIC.has(w);
      return (
        (usable(key) && k.subject.includes(key!)) ||
        (usable(other) && subj.includes(other!)) ||
        subj.join(" ") === k.subject.join(" ")
      );
    });
    if (!dup) kept.push({ lead, subject: subj });
  }
  return kept.map((k) => k.lead);
}

export function parseNewsFeed(xml: string): Lead[] {
  const raw = parser.parse(xml)?.rss?.channel?.item;
  const items: Item[] = raw ? [].concat(raw) : [];
  return items.flatMap((i) => {
    if (!i.title || !i.link) return [];
    const outlet = typeof i.source === "object" ? i.source["#text"] : i.source;
    // Google News appends " - Outlet" to every headline.
    const title = htmlToText(String(i.title)).replace(/\s+-\s+[^-]+$/, "");
    return [
      {
        id: createHash("sha1").update(`funding:${title.toLowerCase()}`).digest("hex"),
        source: "funding" as const,
        title,
        text: "",
        url: String(i.link),
        postedAt: i.pubDate ? new Date(i.pubDate).toISOString() : undefined,
        origin: outlet,
      },
    ];
  });
}

/** Funding announcements from Google News search, e.g. "Seed round" stories about Indian startups. */
export async function searchFunding(query: string): Promise<Lead[]> {
  const params = new URLSearchParams({ q: `${query} when:3d`, hl: "en-IN", gl: "IN", ceid: "IN:en" });
  return parseNewsFeed(await getText(`https://news.google.com/rss/search?${params}`));
}
