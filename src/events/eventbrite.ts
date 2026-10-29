import { htmlToText, request } from "../http";
import type { City, EventsConfig } from "./config";
import { eventId, inCity } from "./filter";
import type { EventItem } from "./types";

interface LdEvent {
  "@type"?: string;
  name?: string;
  url?: string;
  startDate?: string;
  location?: { "@type"?: string; address?: { addressLocality?: string }; name?: string };
  organizer?: { name?: string };
}

/** Events listed in the page's JSON-LD, with no price or ticket status yet. */
export function parseEventbriteList(html: string, where: City | "online"): EventItem[] {
  const items: LdEvent[] = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) {
    try {
      const data = JSON.parse(m[1]!) as { itemListElement?: { item?: LdEvent }[] };
      for (const el of data.itemListElement ?? []) if (el.item?.["@type"] === "Event") items.push(el.item);
    } catch {
      // not JSON we understand; skip this block
    }
  }
  return items
    .filter((e) => e.name && e.url && e.startDate)
    .filter((e) => where === "online" || inCity(e.location?.address?.addressLocality ?? e.location?.name, where))
    .map((e) => ({
      id: eventId(e.url!),
      title: htmlToText(e.name!),
      url: e.url!,
      source: "eventbrite" as const,
      start: e.startDate!,
      where: where === "online" ? "Online" : where.name,
      virtual: where === "online",
      host: e.organizer?.name,
    }));
}

/** An Eventbrite event page says whether it is free and its tickets are on sale. */
export function isOpenAndFree(html: string): boolean {
  return /"isFree":true/.test(html) && /"salesStatus":\{"salesStatus":"on_sale"/.test(html);
}

// Eventbrite refuses requests that don't look like a browser.
const BROWSER_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};
const getText = async (url: string) => (await request(url, { headers: BROWSER_HEADERS })).text();

const listUrl = (slug: string, page: number) =>
  `https://www.eventbrite.com/d/${slug}/free--events/${page > 1 ? `?page=${page}` : ""}`;

async function fetchList(slug: string, where: City | "online", pages: number): Promise<EventItem[]> {
  const out: EventItem[] = [];
  for (let page = 1; page <= pages; page++) {
    try {
      out.push(...parseEventbriteList(await getText(listUrl(slug, page)), where));
    } catch (err) {
      if (page === 1) throw err;
      break;
    }
  }
  return out;
}

export const fetchEventbriteCity = (city: City, cfg: EventsConfig) =>
  fetchList(`india--${city.name.toLowerCase()}`, city, cfg.eventbrite.max_pages);

export const fetchEventbriteOnline = (cfg: EventsConfig) => fetchList("online", "online", cfg.eventbrite.max_pages);

/** Keeps only the candidates whose own page confirms they are free and on sale. */
export async function confirmEventbrite(candidates: EventItem[], maxChecks: number): Promise<EventItem[]> {
  const kept: EventItem[] = [];
  for (const e of candidates.slice(0, maxChecks)) {
    try {
      if (isOpenAndFree(await getText(e.url))) kept.push(e);
    } catch {
      // an event page that won't load is skipped rather than guessed at
    }
  }
  return kept;
}
