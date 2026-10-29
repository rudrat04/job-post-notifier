import { describe, expect, it } from "vitest";
import type { EventsConfig } from "../src/events/config";
import { buildEventMatcher, dedupeEvents } from "../src/events/filter";
import { parseMeetup } from "../src/events/meetup";
import { parseLuma } from "../src/events/luma";
import type { EventItem } from "../src/events/types";

const city = { name: "Pune", lat: 18.5, lon: 73.8, places: ["pune", "pimpri"] };
const cfg = {
  window_days: 30,
  cities: [city],
  virtual: true,
  topics: ["ai", "marketing", "startups?"],
  exclude: ["party", "training"],
  luma: { max_pages: 1 },
  meetup: { online_queries: [] },
} as EventsConfig;
const now = Date.parse("2026-10-29T00:00:00Z");
const day = (n: number) => new Date(now + n * 86_400_000).toISOString();
const ev = (o: Partial<EventItem>): EventItem => ({
  id: "x", title: "AI Meetup", url: "https://luma.com/a", source: "luma", start: day(3), where: "Pune", virtual: false, ...o,
});

describe("event matcher", () => {
  const match = buildEventMatcher(cfg);
  it("keeps on-topic events inside the window", () => {
    expect(match(ev({}), now)).toBe(true);
    expect(match(ev({ title: "Startups Mixer" }), now)).toBe(true);
  });
  it("drops off-topic, excluded, past and too-distant events", () => {
    expect(match(ev({ title: "Salsa Night" }), now)).toBe(false);
    expect(match(ev({ title: "AI Party" }), now)).toBe(false);
    expect(match(ev({ start: day(-1) }), now)).toBe(false);
    expect(match(ev({ start: day(45) }), now)).toBe(false);
  });
  it("matches whole words only", () => {
    expect(match(ev({ title: "Maid service" }), now)).toBe(false);
  });
  it("uses the host name as a topic hint", () => {
    expect(match(ev({ title: "Evening talk", host: "Marketing Guild" }), now)).toBe(true);
  });
  it("keeps a date-only event that is today", () => {
    expect(match(ev({ start: "2026-10-29" }), now + 3_600_000)).toBe(true);
  });
});

describe("dedupeEvents", () => {
  it("keeps one event per title and place, preferring the soonest and Luma", () => {
    const out = dedupeEvents([
      ev({ source: "meetup", url: "https://eb/1", start: "2026-11-01" }),
      ev({ source: "luma", url: "https://luma.com/a", start: "2026-11-01T10:00:00Z" }),
      ev({ source: "meetup", url: "https://eb/2", start: "2026-11-09" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.source).toBe("luma");
  });
  it("gives the same id to a repeat of the same event", () => {
    const [a] = dedupeEvents([ev({ start: day(2) })]);
    const [b] = dedupeEvents([ev({ start: day(9), url: "https://luma.com/b" })]);
    expect(a!.id).toBe(b!.id);
  });
});

describe("parseLuma", () => {
  const entry = (o: Record<string, unknown>) => ({
    event: { name: "AI Night", url: "abc", start_at: day(2), location_type: "offline", geo_address_info: { city: "Pune" } },
    calendar: { name: "Host" },
    ticket_info: { is_free: true, is_sold_out: false, require_approval: false },
    registration_availability: "open",
    ...o,
  });
  it("keeps free, open, in-city events", () => {
    expect(parseLuma([entry({})] as never, city)[0]).toMatchObject({ url: "https://luma.com/abc", where: "Pune", host: "Host" });
  });
  it("drops paid, full, waitlisted, online and out-of-city events", () => {
    const bad = [
      entry({ ticket_info: { is_free: false } }),
      entry({ ticket_info: { is_free: true, is_sold_out: true } }),
      entry({ registration_availability: "waitlist" }),
      entry({ event: { name: "x", url: "u", start_at: day(1), location_type: "online" } }),
      entry({ event: { name: "x", url: "u", start_at: day(1), location_type: "offline", geo_address_info: { city: "Delhi" } } }),
    ];
    expect(parseLuma(bad as never, city)).toHaveLength(0);
  });
});

describe("parseMeetup", () => {
  const page = (events: Record<string, unknown>) =>
    `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { __APOLLO_STATE__: { "Group:1": { name: "Growth Guild" }, ...events } } },
    })}</script>`;
  const base = { eventType: "ONLINE", rsvpState: "JOIN_OPEN", feeSettings: null, group: { __ref: "Group:1" }, title: "AI Talk", dateTime: "2026-11-02T19:00:00+05:30", eventUrl: "https://www.meetup.com/g/events/1/" };
  it("keeps free online events with open RSVP", () => {
    expect(parseMeetup(page({ "Event:1": base }))[0]).toMatchObject({ where: "Online", virtual: true, host: "Growth Guild", source: "meetup" });
  });
  it("drops paid, closed and in-person events", () => {
    const out = parseMeetup(
      page({
        "Event:1": { ...base, feeSettings: { amount: 5 } },
        "Event:2": { ...base, rsvpState: "CLOSED" },
        "Event:3": { ...base, eventType: "PHYSICAL" },
      }),
    );
    expect(out).toHaveLength(0);
  });
  it("returns nothing when the page has no data", () => {
    expect(parseMeetup("<html></html>")).toEqual([]);
  });
});
