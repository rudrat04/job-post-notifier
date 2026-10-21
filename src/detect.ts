import { getText } from "./http";
import type { Ats, CompanyEntry, ResolvedCompany } from "./types";

// Order matters: the Greenhouse embed URL must be tried before the plain board URL.
const PATTERNS: [Ats, RegExp][] = [
  ["greenhouse", /greenhouse\.io\/embed\/job_board(?:\/js)?\?for=([\w-]+)/i],
  ["greenhouse", /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?!embed\b)([\w-]+)/i],
  ["greenhouse", /boards-api\.greenhouse\.io\/v1\/boards\/([\w-]+)/i],
  ["lever", /jobs\.lever\.co\/([\w.-]+)/i],
  ["lever", /api\.lever\.co\/v0\/postings\/([\w.-]+)/i],
  ["ashby", /jobs\.ashbyhq\.com\/([\w.%-]+)/i],
  ["ashby", /api\.ashbyhq\.com\/posting-api\/job-board\/([\w.%-]+)/i],
  ["workable", /apply\.workable\.com\/(?!api\b)([\w-]+)/i],
  ["workable", /apply\.workable\.com\/api\/v\d\/(?:widget\/)?accounts\/([\w-]+)/i],
];

export function detectFromText(text: string): { ats: Ats; slug: string } | null {
  for (const [ats, re] of PATTERNS) {
    const m = text.match(re);
    if (m) return { ats, slug: decodeURIComponent(m[1]) };
  }
  return null;
}

function nameFromSlug(slug: string): string {
  return slug.replace(/[-_.]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Works out which ATS a company uses. Tries, in order: an explicit ats/slug in
 * the config, the URL itself, then the career page's HTML for an embedded board.
 */
export async function resolveCompany(entry: CompanyEntry): Promise<ResolvedCompany> {
  let found: { ats: Ats; slug: string } | null =
    entry.ats && entry.slug ? { ats: entry.ats, slug: entry.slug } : detectFromText(entry.url);

  if (!found) {
    const html = await getText(entry.url);
    found = detectFromText(html);
  }
  if (!found) {
    throw new Error("No Greenhouse, Lever, Ashby or Workable board found on this page");
  }
  return { name: entry.name ?? nameFromSlug(found.slug), url: entry.url, ...found };
}
