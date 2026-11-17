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

/** Verbs that make an ask when they open a sentence: "Looking for a…", "Need a…", "Hiring: …". */
const OPENERS = "looking for|looking to hire|seeking|searching for|in search of|need(?:ed|s)?|hiring|wanted|lf";

/**
 * Keeps explicit requests for help and drops promotion, job seekers and discussion. An ask
 * is explicit when it is in the first person ("we're looking for", "I need"), a question to
 * the crowd ("can anyone recommend"), or a sentence or clause that opens with the ask
 * ("Looking for a HubSpot consultant", "…and need someone to…"). "Every founder needs a GTM engineer" and "I
 * recommend a consultant" are not asks. A post counts when
 *  (a) an explicit ask is followed closely by a person ("looking for a GTM consultant") and
 *      a service is named anywhere in the start of the post, or
 *  (b) a service is followed by "needed" ("automation expert needed"), or
 *  (c) an explicit ask is followed by "help" or the service itself ("need an n8n workflow")
 *      AND the post mentions paying or hiring, since that is also how support questions read.
 * Freelancer.com projects are requests by nature, so they only need to name a service.
 */
export function buildLeadMatcher(config: LeadsConfig) {
  const intent = config.intent.join("|");
  const services = config.services.join("|");
  const edge = (body: string) => new RegExp(`(?<![\\w])(?:${body})(?![\\w])`, "i");
  // A sentence or clause start: the start of the title or post, after . ! ? : | , or a [tag],
  // after "and" / "so" ("we launched last month and need someone…"), optionally after "Hi all,".
  const opener = `(?:^|[.!?:|,\\n]\\s*|\\]\\s*|(?<![\\w])(?:and|so)\\s+)(?:(?:hi|hey|hello)(?: \\w+)?[,!.]?\\s+)?(?:${OPENERS})`;
  const ask = `(?:${opener}|(?<![\\w])(?:${intent}))`;
  const after = (what: string) => new RegExp(`${ask}\\W+${GAP}(?:${what})(?![\\w])`, "i");
  // "help" and bare tool names are also how people ask support questions ("need help with
  // my n8n node"), so those asks count only when the post talks about paying or hiring.
  const people = config.roles.filter((r) => r !== "help").join("|");
  const askPerson = after(people);
  const askHelp = new RegExp(`${after("help").source}|(?<![\\w])help\\W+(?:needed|wanted|required)(?![\\w])`, "i");
  const askService = after(services);
  const paid =
    /(?<![\w])(?:pay(?:ing)?|paid|budget|hire|hiring|rate|freelanc\w*|contract\w*|compensat\w*|quote|gig)(?![\w])|[$₹€£]\s?\d|\d+\s?(?:usd|inr|k)\b/i;
  const serviceNeeded = edge(`(?:${services})\\W+(?:\\w+\\W+){0,2}?(?:needed|wanted|required)`);
  const anyService = edge(services);
  const freelanceWork = /(?<![\w])(?:contract(?:or)?|fractional|freelance|part[- ]time|project[- ]based)(?![\w])/i;
  const exclude = anyOf(config.exclude);
  const excludeText = anyOf(config.exclude_text);
  const maxAgeMs = config.max_age_days * 86_400_000;

  return function match(lead: Lead, now = Date.now()): boolean {
    const posted = lead.postedAt ? Date.parse(lead.postedAt) : NaN;
    if (!Number.isNaN(posted) && now - posted > maxAgeMs) return false;

    const title = normalize(lead.title);
    const body = normalize(lead.text).slice(0, READ_CHARS);
    const text = `${title}. ${body}`;
    if (exclude?.test(title)) return false;
    // Adverts give themselves away late ("starting at ₹1,699 ... DM me"), so read the whole post for these.
    if (excludeText?.test(`${title}. ${normalize(lead.text).slice(0, FULL_CHARS)}`)) return false;
    // Adverts often open with "I will build your website…".
    if (/^(?:i will|i can|we offer|i offer)\b/.test(body.trim())) return false;
    if (!anyService.test(text)) return false;
    // A client's project post on a marketplace, or a "[hiring]" tag, is an ask already.
    if (lead.source === "freelancer" || /^\s*\[hiring\]/.test(title)) return true;
    // "Who is hiring" threads are employers; only contract and fractional roles are freelance work.
    if (lead.origin && /who is hiring/i.test(lead.origin)) return freelanceWork.test(text);
    if (askPerson.test(text) || serviceNeeded.test(text)) return true;
    // A forum's hiring section holds requests, so asking for help there needn't mention pay.
    return (askHelp.test(text) || askService.test(text)) && (lead.asking || paid.test(text));
  };
}
