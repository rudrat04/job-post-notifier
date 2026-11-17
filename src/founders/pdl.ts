import { HttpError, request } from "../http";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** PDL's free plan allows 10 searches a minute. */
const GAP_MS = 6_500;
let last = 0;

/** "Founder's Office" → "founders office": PDL stores job titles lower-case, without punctuation. */
export const pdlPhrase = (role: string) => role.toLowerCase().replace(/['’`]/g, "").replace(/[\s-]+/g, " ").trim();

/** The Elasticsearch query: someone whose current job is at `company` with one of the titles. */
export function pdlQuery(company: string, phrases: string[]) {
  return {
    size: 1,
    query: {
      bool: {
        must: [
          { term: { job_company_name: company.toLowerCase() } },
          { bool: { should: phrases.map((p) => ({ match_phrase: { job_title: p } })) } },
        ],
      },
    },
  };
}

/**
 * People Data Labs Person Search. Credits are charged per record returned, so a company with
 * no one in the roles costs nothing, and one that has someone costs 1. Returns e.g.
 * "rahul verma (chief of staff)", or null when no one is found. PDL's job data lags LinkedIn
 * by months, so "no one" from here is a weak signal; a match is a strong one.
 */
export async function pdlRoleHolder(company: string, roles: string[], env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  if (!env.PDL_API_KEY) throw new Error("PDL_API_KEY is not set");
  const wait = last + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const phrases = [...new Set(roles.map(pdlPhrase))];
  try {
    const res = await request(
      "https://api.peopledatalabs.com/v5/person/search",
      {
        method: "POST",
        headers: { "x-api-key": env.PDL_API_KEY, "content-type": "application/json" },
        body: JSON.stringify(pdlQuery(company, phrases)),
      },
      0,
    );
    const data = (await res.json()) as { data?: { full_name?: string; job_title?: string }[] };
    const p = data.data?.[0];
    return p ? `${p.full_name ?? "someone"} (${p.job_title ?? "role"})` : null;
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null; // PDL's "no records found"
    throw err;
  }
}
