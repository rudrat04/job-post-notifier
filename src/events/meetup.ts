import { request } from "../http";
import type { EventsConfig } from "./config";
import { eventId } from "./filter";
import type { EventItem } from "./types";

interface MeetupEvent {
  __typename?: string;
  title?: string;
  dateTime?: string;
  eventType?: string;
  eventUrl?: string;
  rsvpState?: string;
  feeSettings?: unknown;
  group?: { __ref?: string };
  rsvps?: { totalCount?: number };
}

// Meetup serves its search results as page data; it refuses requests that don't look like a browser.
const BROWSER_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml",
  "accept-language": "en-US,en;q=0.9",
};

/** Free online events whose RSVP is open, from the page's Apollo state. */
export function parseMeetup(html: string): EventItem[] {
  const raw = html.match(/__NEXT_DATA__[^>]*>(.*?)<\/script>/s)?.[1];
  if (!raw) return [];
  const state = (JSON.parse(raw) as { props?: { pageProps?: { __APOLLO_STATE__?: Record<string, unknown> } } }).props
    ?.pageProps?.__APOLLO_STATE__ ?? {};
  const groupName = (ref?: string) => (state[ref ?? ""] as { name?: string } | undefined)?.name;

  return Object.entries(state)
    .filter(([key]) => key.startsWith("Event:"))
    .map(([, v]) => v as MeetupEvent)
    .filter((e) => e.eventType === "ONLINE" && e.rsvpState === "JOIN_OPEN" && !e.feeSettings)
    .filter((e) => e.title && e.eventUrl && e.dateTime)
    .map((e) => ({
      id: eventId(e.eventUrl!),
      title: e.title!.replace(/[​‌‍﻿]/g, "").trim(),
      url: e.eventUrl!,
      source: "meetup" as const,
      start: e.dateTime!,
      where: "Online",
      virtual: true,
      host: groupName(e.group?.__ref),
      guests: e.rsvps?.totalCount,
    }));
}

export async function fetchMeetupOnline(keyword: string): Promise<EventItem[]> {
  const params = new URLSearchParams({ source: "EVENTS", eventType: "online", keywords: keyword });
  const res = await request(`https://www.meetup.com/find/?${params}`, { headers: BROWSER_HEADERS });
  return parseMeetup(await res.text());
}

export const meetupQueries = (cfg: EventsConfig) => cfg.meetup.online_queries;
