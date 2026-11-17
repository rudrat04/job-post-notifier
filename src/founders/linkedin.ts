import { htmlToText } from "../http";
import type { SearchResult } from "../leads/sources/websearch";

/** Someone's public LinkedIn profile, as Google shows it. */
export interface Profile {
  name: string;
  /** What Google shows after the name: "Co-Founder & CEO - Acme". */
  headline: string;
  url: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "Founder's Office" also matches "Founders Office" and "Founder’s office"; "GTM Engineer" matches "GTM-Engineer". */
export function rolePattern(roles: string[]): RegExp {
  const parts = roles.map((r) =>
    escapeRe(r.toLowerCase().replace(/[’`]/g, "'"))
      .replace(/s'/g, "s['’]?")
      .replace(/'s\b/g, "['’]?s['’]?")
      .replace(/[\s-]+/g, "[\\s-]+"),
  );
  return new RegExp(`(?<![\\w])(?:${parts.join("|")})(?![\\w])`, "i");
}

const quote = (w: string) => `"${w.replace(/"/g, "")}"`;

/** site:linkedin.com/in "Acme" (founder OR "co-founder") */
export const founderQuery = (company: string) => `site:linkedin.com/in ${quote(company)} (founder OR "co-founder")`;

/**
 * The phrases worth sending to Google. It ignores apostrophes and words past about 32, so
 * "Founders Office" repeats "Founder's Office", and "Product Marketing Manager" adds nothing
 * once "Product Marketing" is searched. The full list is still used to match results.
 */
export function searchPhrases(roles: string[]): string[] {
  const key = (r: string) => ` ${r.toLowerCase().replace(/['’`]/g, "").replace(/[\s-]+/g, " ").trim()} `;
  const keys = roles.map(key);
  return roles.filter((r, i) => !keys.some((k, j) => j !== i && keys[i].includes(k) && (k !== keys[i] || j < i)));
}

/** Google ignores words past about 32, so the role list is cut to fit, in the configured order. */
const GOOGLE_WORDS = 28;

/** site:linkedin.com/in "Acme" ("GTM Engineer" OR "Chief of Staff" OR …) */
export function roleQuery(company: string, roles: string[]): string {
  let words = 2 + company.split(/\s+/).length;
  const kept: string[] = [];
  for (const r of searchPhrases(roles)) {
    const n = r.split(/[\s-/]+/).length + (kept.length ? 1 : 0); // + "OR"
    if (words + n > GOOGLE_WORDS) break;
    words += n;
    kept.push(r);
  }
  return `site:linkedin.com/in ${quote(company)} (${kept.map(quote).join(" OR ")})`;
}

const normalize = (s: string) => htmlToText(s).replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();

/** "Priya Shah - Co-Founder - Acme | LinkedIn" → name and headline. Null for anything but a profile. */
export function parseProfile(r: SearchResult): Profile | null {
  if (!r.link || !r.title || !/linkedin\.com\/in\/[^/?#]+/i.test(r.link)) return null;
  const title = normalize(r.title).replace(/\s*[|·-]\s*LinkedIn\s*$/i, "");
  const [rawName, ...rest] = title.split(/\s+[-–—|]\s+/);
  // "Priya Shah, CFA" → "Priya Shah".
  const name = rawName.split(",")[0].trim();
  if (!name || name.split(/\s+/).length > 5) return null;
  const url = r.link.split("?")[0].replace(/^https?:\/\/[a-z]{2,3}\.linkedin/i, "https://www.linkedin");
  return { name, headline: rest.join(" - "), url };
}

/**
 * Whether a result is about someone at this company: the company stands as its own part of
 * the title or snippet ("Priya Shah - Founder - Acme", "Chief of Staff | Acme. Jun 2025 -
 * Present", "Founder at Acme", "Experience: Acme"). A bare mention inside a sentence is not
 * enough, since short names are common words ("5 per cent").
 */
export function atCompany(r: SearchResult, company: string): boolean {
  const text = `${normalize(r.title ?? "").replace(/\s*[|·-]\s*linkedin\s*$/i, "")} · ${normalize(r.snippet ?? "")}`;
  return companyPart(company).test(text);
}

function companyPart(company: string): RegExp {
  const c = escapeRe(company.toLowerCase()).replace(/\s+/g, "[\\s-]*");
  // Google cuts long titles short and companies add "Technologies", "Pvt Ltd" and the like.
  const suffix = "(?:\\.\\w{2,3})?(?:\\s+(?:technologies|technology|tech|labs|inc\\.?|pvt\\.?|private|ltd\\.?|limited|ai|hq|india|global))*(?:\\s*(?:\\.\\.\\.|…))?";
  return new RegExp(
    `(?:^|[-–—|@·.;:,]|\\bat|\\bof|\\bexperience:|\\bfounded|\\bbuilding)\\s*${c}${suffix}\\s*(?:$|[-–—|,(.·;:])`,
    "i",
  );
}

/** Titles that contain "founder" without being one. */
const NOT_FOUNDER = /founder\/ceo'?s? office|founder'?s'? (?:office|associate)|founders? office|associate to (?:the )?founders?|(?:office|staff) of (?:the )?founders?|founder in residence|founding (?:engineer|member|team|designer|hire)/gi;
const PAST = /(?:ex-?|former(?:ly)?|previously|past)\s*$/i;

/** True when `pattern` appears in the text and isn't introduced as a past job ("ex-Chief of Staff"). */
function currently(text: string, pattern: RegExp): boolean {
  const re = new RegExp(pattern.source, "gi");
  for (const m of text.matchAll(re)) if (!PAST.test(text.slice(Math.max(0, m.index! - 14), m.index))) return true;
  return false;
}

export function isFounder(r: SearchResult): boolean {
  const text = `${normalize(r.title ?? "")} ${normalize(r.snippet ?? "")}`.replace(NOT_FOUNDER, " ");
  return currently(text, /(?<![\w])(?:co-?)?founder(?![\w])/);
}

export function holdsRole(r: SearchResult, roles: RegExp): boolean {
  return currently(`${normalize(r.title ?? "")} ${normalize(r.snippet ?? "")}`, roles);
}

/** The founders of `company` among search results, up to `max`. "Building Acme" in a headline counts. */
export function foundersIn(results: SearchResult[], company: string, max: number): Profile[] {
  const seen = new Set<string>();
  const found: Profile[] = [];
  const building = new RegExp(`(?<![\\w])building\\s+${escapeRe(company)}(?![\\w])`, "i");
  for (const r of results) {
    if (!atCompany(r, company)) continue;
    if (!isFounder(r) && !building.test(normalize(r.title ?? ""))) continue;
    const p = parseProfile(r);
    if (!p || seen.has(p.url)) continue;
    seen.add(p.url);
    found.push(p);
    if (found.length >= max) break;
  }
  return found;
}

/** The people at `company` already in one of the roles, e.g. "Rahul Verma (Chief of Staff)". */
export function roleHoldersIn(results: SearchResult[], company: string, roles: RegExp): string[] {
  return results.flatMap((r) => {
    if (!atCompany(r, company) || !holdsRole(r, roles)) return [];
    const p = parseProfile(r);
    const role = `${normalize(r.title ?? "")} ${normalize(r.snippet ?? "")}`.match(new RegExp(roles.source, "i"))?.[0];
    return p ? [`${p.name}${role ? ` (${role})` : ""}`] : [];
  });
}

/** LinkedIn's own search pages: free links for checking a company by hand. */
export const linkedinCompanySearch = (company: string) =>
  `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(company)}`;
