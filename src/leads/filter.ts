import type { LeadsConfig } from "./config";
import type { Lead } from "./types";

const anyOf = (patterns: string[]) =>
  patterns.length ? new RegExp(`(?<![\\w])(?:${patterns.join("|")})(?![\\w])`, "i") : null;

const normalize = (s: string) => s.toLowerCase().replace(/[‘’`´]/g, "'");

/** Only the start of a long post is read; the ask is nearly always up front. */
const READ_CHARS = 500;
/** How much of a post is read when looking for advert signals. */
const FULL_CHARS = 4000;
/** Filler words allowed between an asking verb and what is asked for ("looking for a good freelance GTM consultant"). */
const GAP = "(?:\\w+\\W+){0,4}?";

/**
 * Keeps requests for help and drops people advertising themselves. A post counts when
 *  (a) an asking verb is followed closely by a person ("looking for a GTM consultant") and
 *      a service is named anywhere in the start of the post, or
 *  (b) a service is followed by "needed" ("automation expert needed"), or
 *  (c) an asking verb is followed by "help" or the service itself ("need an n8n workflow")
 *      AND the post mentions paying or hiring, since that is also how support questions read.
 * "Need a ride to the polls" fails all three. Funding stories are leads by nature and skip this.
 */
export function buildLeadMatcher(config: LeadsConfig) {
  const intent = config.intent.join("|");
  const roles = config.roles.join("|");
  const services = config.services.join("|");
  const edge = (body: string) => new RegExp(`(?<![\\w])(?:${body})(?![\\w])`, "i");
  // "help" and bare tool names are also how people ask support questions ("need help with
  // my n8n node"), so those asks count only when the post talks about paying or hiring.
  const people = config.roles.filter((r) => r !== "help").join("|");
  const askPerson = edge(`(?:${intent})\\W+${GAP}(?:${people})`);
  const askHelp = edge(`(?:${intent})\\W+${GAP}help|help\\W+(?:needed|wanted|required)`);
  const askService = edge(`(?:${intent})\\W+${GAP}(?:${services})`);
  const paid =
    /(?<![\w])(?:pay(?:ing)?|paid|budget|hire|hiring|rate|freelanc\w*|contract\w*|compensat\w*|quote|gig)(?![\w])|[$₹€£]\s?\d|\d+\s?(?:usd|inr|k)\b/i;
  const serviceNeeded = edge(`(?:${services})\\W+(?:\\w+\\W+){0,2}?(?:needed|wanted|required)`);
  const anyService = edge(services);
  const anyAsk = edge(`${intent}|${roles}|needed|wanted|required|pay`);
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
    // Adverts give themselves away late ("starting at ₹1,699 ... DM me"), so read the whole post for these.
    if (excludeText?.test(`${title}. ${normalize(lead.text).slice(0, FULL_CHARS)}`)) return false;
    // Adverts often open with "I will build your website…".
    if (/^(?:i will|i can|we offer|i offer)\b/.test(body.trim())) return false;
    // A "[hiring]" tag counts as an ask, so only a service needs to be named.
    if (/^\s*\[hiring\]/.test(title)) return anyService.test(text);
    // A forum's hiring section holds requests, so any sign of asking will do.
    if (lead.asking) return anyService.test(text) && anyAsk.test(text);
    if (!anyService.test(text)) return false;
    if (askPerson.test(text) || serviceNeeded.test(text)) return true;
    return (askHelp.test(text) || askService.test(text)) && paid.test(text);
  };
}
