export type EventSource = "luma" | "eventbrite";

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
  /** The host has to approve each registration. */
  needsApproval?: boolean;
}
