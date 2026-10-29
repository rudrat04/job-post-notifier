import { createHash } from "node:crypto";
import type { City, EventsConfig } from "./config";
import type { EventItem } from "./types";

const normalize = (s: string) => s.toLowerCase().replace(/[‘’`´]/g, "'");

function anyOf(patterns: string[]): RegExp | null {
  if (!patterns.length) return null;
  return new RegExp(`(?<![\\w])(?:${patterns.join("|")})(?![\\w])`, "i");
}

export const eventId = (url: string) => createHash("sha1").update(url.split("?")[0]!.replace(/\/$/, "")).digest("hex");

/** True when the event's own place name is one of the city's places. */
export function inCity(place: string | undefined, city: City): boolean {
  const p = normalize(place ?? "");
  return city.places.some((c) => p.includes(c));
}

export function buildEventMatcher(cfg: EventsConfig) {
  const topics = anyOf(cfg.topics)!;
  const exclude = anyOf(cfg.exclude);
  const windowMs = cfg.window_days * 86_400_000;

  const brands = anyOf(cfg.big.brands);

  const community = anyOf(cfg.big.community_words);
  // The company must be the organizer (calendar or host), not just named in the title, and not
  // a student chapter or user group that borrows its name. Meetup groups are community-run, so
  // only Luma organizers count.
  const byBrand = (e: EventItem) => {
    const organizers = normalize(e.organizers ?? "");
    return e.source === "luma" && !!brands && brands.test(organizers) && !community?.test(organizers);
  };

  /** Big when a well-known company is behind it or many people have registered. */
  function markBig(e: EventItem): EventItem {
    const byGuests = (e.guests ?? 0) >= cfg.big.min_guests;
    return { ...e, big: byBrand(e) || byGuests };
  }

  const matchEvent = function match(e: EventItem, now = Date.now()): boolean {
    const start = Date.parse(e.start);
    // A date-only start means the whole day, so keep today's events until the day ends.
    const endOfStart = /^\d{4}-\d{2}-\d{2}$/.test(e.start) ? start + 86_400_000 : start;
    if (Number.isNaN(start) || endOfStart < now || start - now > windowMs) return false;
    const title = normalize(e.title);
    if (exclude?.test(title)) return false;
    return topics.test(title) || topics.test(normalize(e.host ?? "")) || byBrand(e);
  };

  return Object.assign(matchEvent, { markBig });
}

const titleKey = (e: EventItem) =>
  createHash("sha1")
    .update(`${normalize(e.title).replace(/[^a-z0-9]+/g, " ").trim()}|${e.where}`)
    .digest("hex");

/**
 * One entry per title and place: the same event on Luma and Eventbrite, or one session
 * repeated on many dates, is kept once (the soonest day, preferring Luma for its start time).
 * The id becomes that key, so a repeat is not emailed again later.
 */
export function dedupeEvents(events: EventItem[]): EventItem[] {
  const best = new Map<string, EventItem>();
  const rank = (e: EventItem) => [Date.parse(e.start.slice(0, 10)) || Infinity, e.source === "luma" ? 0 : 1] as const;
  for (const e of events) {
    const key = titleKey(e);
    const cur = best.get(key);
    if (!cur) best.set(key, { ...e, id: key });
    else {
      const [a, b] = [rank(e), rank(cur)];
      const winner = a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? e : cur;
      best.set(key, { ...winner, id: key, big: e.big || cur.big });
    }
  }
  return [...best.values()];
}
