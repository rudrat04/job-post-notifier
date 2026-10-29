export type EventSource = "luma" | "meetup";

export interface EventItem {
  /** Dedupe key: sha1 of the event URL. */
  id: string;
  title: string;
  url: string;
  source: EventSource;
  /** ISO start time (date only for some Eventbrite listings). */
  start: string;
  /** City name, or "Online". */
  where: string;
  virtual: boolean;
  host?: string;
  /** Everything that names who is behind the event: calendar, hosts, group. */
  organizers?: string;
  /** People registered so far. */
  guests?: number;
  /** The host has to approve each registration. */
  needsApproval?: boolean;
  /** A well-known company is behind it, or many people have registered. */
  big?: boolean;
}
