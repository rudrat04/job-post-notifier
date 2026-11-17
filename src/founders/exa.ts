import { request } from "../http";
import { companyKey } from "./funding";
import type { Profile } from "./linkedin";

/** One person from Exa's "people" search, with their LinkedIn work history. */
export interface ExaPerson {
  title?: string;
  url?: string;
  entities?: {
    properties?: {
      name?: string;
      workHistory?: { title?: string; dates?: { from?: string | null; to?: string | null } | null; company?: { name?: string } | null }[];
    };
  }[];
}

/** Words companies add to their name: "Olyv India (formerly SmartCoin)", "Acme Technologies Pvt Ltd". */
const SUFFIX = /\b(?:india|technologies|technology|tech|labs|inc|pvt|private|ltd|limited|llp|corp|hq|global|ai)\b\.?/gi;

const bareName = (name: string) => companyKey(name.replace(/\(.*?\)/g, " ").replace(SUFFIX, " ")) || companyKey(name);

/** Whether a work-history company is the one we're looking at. */
export const sameCompany = (a: string, b: string) => bareName(a) === bareName(b);

/** The person's current jobs at `company` (no end date). */
export function currentTitlesAt(person: ExaPerson, company: string): string[] {
  const jobs = person.entities?.[0]?.properties?.workHistory ?? [];
  return jobs.flatMap((j) =>
    j.title && j.company?.name && sameCompany(j.company.name, company) && j.dates && j.dates.to == null ? [j.title] : [],
  );
}

const NOT_FOUNDER = /founder\/ceo'?s? office|founder'?s'? (?:office|associate)|founders? office|associate to (?:the )?founders?|founder in residence|founding (?:engineer|member|team|designer|hire|gtm)/gi;
const FOUNDER = /(?<![\w])(?:(?:co-?)?founder|ceo)(?![\w])/i;

const linkedinUrl = (url: string) => url.split("?")[0].replace(/^https?:\/\/(?:[a-z]{2,3}\.|www\.)?linkedin\.com/i, "https://www.linkedin.com");

/** Founders (or the CEO) currently at `company`, up to `max`. */
export function exaFounders(people: ExaPerson[], company: string, max: number): Profile[] {
  const found: Profile[] = [];
  for (const p of people) {
    const name = p.entities?.[0]?.properties?.name ?? p.title;
    if (!name || !p.url || !/linkedin\.com\/in\//i.test(p.url)) continue;
    const title = currentTitlesAt(p, company).find((t) => FOUNDER.test(t.replace(NOT_FOUNDER, " ")));
    if (!title) continue;
    const url = linkedinUrl(p.url);
    if (found.some((f) => f.url === url)) continue;
    found.push({ name, headline: `${title} - ${company}`, url });
    if (found.length >= max) break;
  }
  return found;
}

/** People currently at `company` in one of the roles, e.g. "Anamaya Shah (Founders Office - Strategy)". */
export function exaRoleHolders(people: ExaPerson[], company: string, roles: RegExp): string[] {
  return people.flatMap((p) => {
    const title = currentTitlesAt(p, company).find((t) => roles.test(t.replace(/[’`]/g, "'")));
    const name = p.entities?.[0]?.properties?.name ?? p.title;
    return title && name ? [`${name} (${title})`] : [];
  });
}

/** Exa people search. About $0.007 a search; the free tier's monthly credit covers well over 1,000. */
export async function searchExaPeople(query: string, num: number, env: NodeJS.ProcessEnv = process.env): Promise<ExaPerson[]> {
  if (!env.EXA_API_KEY) throw new Error("EXA_API_KEY is not set");
  // Billed per request, so a failed one is not retried.
  const res = await request(
    "https://api.exa.ai/search",
    {
      method: "POST",
      headers: { "x-api-key": env.EXA_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ query, category: "people", numResults: num }),
    },
    0,
  );
  return ((await res.json()) as { results?: ExaPerson[] }).results ?? [];
}
