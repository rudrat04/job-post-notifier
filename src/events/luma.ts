import { getJson } from "../http";
import type { City, EventsConfig } from "./config";
import { eventId, inCity } from "./filter";
import type { EventItem } from "./types";

interface LumaEntry {
  event: {
    name: string;
    url: string;
    start_at: string;
    location_type: string;
    geo_address_info?: { city?: string };
  };
  calendar?: { name?: string };
  hosts?: { name?: string }[];
  guest_count?: number;
  ticket_info?: { is_free?: boolean; is_sold_out?: boolean; require_approval?: boolean } | null;
  registration_availability?: string;
}

interface LumaPage {
  entries: LumaEntry[];
  has_more: boolean;
  next_cursor?: string;
}

const API = "https://api.lu.ma/discover/get-paginated-events";

/** Free, in-person events of one city that can still be registered for. */
export function parseLuma(entries: LumaEntry[], city: City): EventItem[] {
  return entries
    .filter(
      (e) =>
        e.event.location_type === "offline" &&
        e.ticket_info?.is_free === true &&
        !e.ticket_info.is_sold_out &&
        e.registration_availability === "open" &&
        inCity(e.event.geo_address_info?.city, city),
    )
    .map((e) => {
      const url = `https://luma.com/${e.event.url}`;
      return {
        id: eventId(url),
        title: e.event.name,
        url,
        source: "luma" as const,
        start: e.event.start_at,
        where: city.name,
        virtual: false,
        host: e.calendar?.name,
        organizers: [e.calendar?.name, ...(e.hosts ?? []).map((h) => h.name)].filter(Boolean).join(" "),
        guests: e.guest_count,
        needsApproval: e.ticket_info?.require_approval || undefined,
      };
    });
}

export async function fetchLuma(city: City, cfg: EventsConfig): Promise<EventItem[]> {
  const endMs = Date.now() + cfg.window_days * 86_400_000;
  const entries: LumaEntry[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < cfg.luma.max_pages; page++) {
    const params = new URLSearchParams({
      latitude: String(city.lat),
      longitude: String(city.lon),
      pagination_limit: "50",
    });
    if (cursor) params.set("pagination_cursor", cursor);
    const data = await getJson<LumaPage>(`${API}?${params}`);
    entries.push(...data.entries);
    const last = data.entries.at(-1);
    if (!data.has_more || !data.next_cursor || !last || Date.parse(last.event.start_at) > endMs) break;
    cursor = data.next_cursor;
  }
  return parseLuma(entries, city);
}
