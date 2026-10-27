import type { LeadsConfig } from "./config";
import type { Lead } from "./types";

const anyOf = (patterns: string[]) =>
  patterns.length ? new RegExp(`(?<![\\w])(?:${patterns.join("|")})(?![\\w])`, "i") : null;

const normalize = (s: string) => s.toLowerCase().replace(/[‘’`´]/g, "'");

/** How far (in characters) a service may sit from the words that ask for it. */
const NEAR = 100;
/** Only the start of a long post is read; the ask is nearly always up front. */
const READ_CHARS = 500;

/**
 * Keeps requests for help and drops people advertising themselves. A post counts when
 * an ask ("looking for", "need", "recommend"...) sits close to one of your services
 * ("...looking for someone to build our landing page"), in either order. Funding
 * stories are leads by nature, so they skip this check.
 */
export function buildLeadMatcher(config: LeadsConfig) {
  const intent = config.intent.join("|");
  const services = config.services.join("|");
  const ask = new RegExp(
    `(?<![\\w])(?:(?:${intent})[\\s\\S]{0,${NEAR}}?(?:${services})|(?:${services})[\\s\\S]{0,${NEAR}}?(?:${intent}))(?![\\w])`,
    "i",
  );
  const exclude = anyOf(config.exclude);
  const maxAgeMs = config.max_age_days * 86_400_000;

  return function match(lead: Lead, now = Date.now()): boolean {
    const posted = lead.postedAt ? Date.parse(lead.postedAt) : NaN;
    if (!Number.isNaN(posted) && now - posted > maxAgeMs) return false;

    if (lead.source === "funding") return true;

    const title = normalize(lead.title);
    const body = normalize(lead.text).slice(0, READ_CHARS);
    if (exclude?.test(title)) return false;
    // Adverts often open with "I will build your website…".
    if (/^(?:i will|i can|we offer|i offer)\b/.test(body.trim())) return false;
    // A "[hiring]" tag counts as an ask, so only a service needs to be named.
    if (/^\s*\[hiring\]/.test(title)) return new RegExp(`(?<![\\w])(?:${services})(?![\\w])`, "i").test(`${title} ${body}`);
    return ask.test(`${title}. ${body}`);
  };
}
