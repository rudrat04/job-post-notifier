import type { LeadsConfig } from "./config";
import type { Lead } from "./types";

const anyOf = (patterns: string[]) =>
  patterns.length ? new RegExp(`(?<![\\w])(?:${patterns.join("|")})(?![\\w])`, "i") : null;

const normalize = (s: string) => s.toLowerCase().replace(/[‘’`´]/g, "'");

/** Only the start of a long post is read; the ask is nearly always up front. */
const READ_CHARS = 500;
/** Filler words allowed between an asking verb and what is asked for ("looking for a good freelance GTM consultant"). */
const GAP = "(?:\\w+\\W+){0,2}?";

/**
 * Keeps requests for help and drops people advertising themselves. A post counts when
 *  (a) an asking verb is followed closely by a role ("looking for a GTM consultant") and
 *      a service is named anywhere in the start of the post, or
 *  (b) an asking verb is followed closely by the service itself ("need a landing page"), or
 *  (c) a service is followed by "needed" ("website developer needed").
 * "Need a ride to the polls" fails all three. Funding stories are leads by nature and skip this.
 */
export function buildLeadMatcher(config: LeadsConfig) {
  const intent = config.intent.join("|");
  const roles = config.roles.join("|");
  const services = config.services.join("|");
  const edge = (body: string) => new RegExp(`(?<![\\w])(?:${body})(?![\\w])`, "i");
  const askRole = edge(`(?:${intent})\\W+${GAP}(?:${roles})`);
  const askService = edge(`(?:${intent})\\W+${GAP}(?:${services})`);
  const serviceNeeded = edge(`(?:${services})\\W+(?:\\w+\\W+){0,2}?(?:needed|wanted|required)`);
  const anyService = edge(services);
  const exclude = anyOf(config.exclude);
  const excludeText = anyOf(config.exclude_text);
  const maxAgeMs = config.max_age_days * 86_400_000;

  return function match(lead: Lead, now = Date.now()): boolean {
    const posted = lead.postedAt ? Date.parse(lead.postedAt) : NaN;
    if (!Number.isNaN(posted) && now - posted > maxAgeMs) return false;

    if (lead.source === "funding") return true;

    const title = normalize(lead.title);
    const body = normalize(lead.text).slice(0, READ_CHARS);
    const text = `${title}. ${body}`;
    if (exclude?.test(title)) return false;
    if (excludeText?.test(text)) return false;
    // Adverts often open with "I will build your website…".
    if (/^(?:i will|i can|we offer|i offer)\b/.test(body.trim())) return false;
    // A "[hiring]" tag counts as an ask, so only a service needs to be named.
    if (/^\s*\[hiring\]/.test(title)) return anyService.test(text);
    return (askRole.test(text) && anyService.test(text)) || askService.test(text) || serviceNeeded.test(text);
  };
}
