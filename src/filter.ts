import type { Filters } from "./config";
import type { Job, MatchedJob } from "./types";

/** Lowercase and fold curly apostrophes so "Founder’s" matches "founder's". */
const normalize = (s: string) => s.toLowerCase().replace(/[‘’`´]/g, "'");

function anyOf(patterns: string[]): RegExp | null {
  if (!patterns.length) return null;
  return new RegExp(`(?<![\\w])(?:${patterns.join("|")})(?![\\w])`, "i");
}

// Words that only say "remote" and name no country or region.
const REMOTE_ONLY = /\b(?:remote|anywhere|worldwide|global|work from home|wfh|fully|first|only|distributed)\b|[-–—,()/|:;.\s]/gi;

const YEARS_PATTERNS = [
  /(\d{1,2})\s*\+\s*(?:years|yrs)/i,
  /(\d{1,2})\s*(?:-|–|to)\s*\d{1,2}\s*(?:years|yrs)/i,
  /(?:minimum|min\.?|at least)\s*(?:of\s*)?(\d{1,2})\s*(?:years|yrs)/i,
];

/** The smallest number of years of experience the posting asks for, if it says. */
export function minExperienceYears(job: Pick<Job, "url" | "description">): number | null {
  const fromUrl = job.url.match(/(\d{1,2})-to-\d{1,2}-years/i);
  if (fromUrl) return Number(fromUrl[1]);
  const found = YEARS_PATTERNS.map((re) => job.description?.match(re)?.[1]).filter(Boolean).map(Number);
  return found.length ? Math.min(...found) : null;
}

export function buildMatcher(filters: Filters) {
  const titles = anyOf(filters.titles);
  const combos = filters.title_combos.map((groups) => groups.map((g) => anyOf(g)!));
  const excludeTitle = anyOf(filters.exclude_title);
  const excludeDesc = anyOf(filters.exclude_description);
  const include = anyOf(filters.include_keywords);
  const cities = anyOf(filters.locations.cities);
  const regions = anyOf(filters.locations.remote_regions);
  const loc = filters.locations;
  const maxAgeMs = filters.max_age_days * 86_400_000;

  return function match(job: Job, now = Date.now()): MatchedJob | null {
    const title = normalize(job.title);
    const desc = normalize(job.description ?? "");
    const location = normalize(job.location);

    if (maxAgeMs) {
      const posted = job.postedAt ? Date.parse(job.postedAt) : NaN;
      if (Number.isNaN(posted) ? !filters.keep_undated : now - posted > maxAgeMs) return null;
    }

    const titleOk = titles?.test(title) || combos.some((groups) => groups.every((g) => g.test(title)));
    if (!titleOk) return null;
    if (excludeTitle?.test(title)) return null;
    if (excludeDesc?.test(desc)) return null;
    if (include && !include.test(title) && !include.test(desc)) return null;
    if (filters.max_experience_years) {
      const years = minExperienceYears(job);
      if (years !== null && years > filters.max_experience_years) return null;
    }

    if (!location.trim()) {
      return loc.keep_missing ? { ...job, locationMissing: true } : null;
    }
    const remote = job.remote || /\bremote\b/.test(location);
    const ok =
      cities?.test(location) ||
      (remote && regions?.test(location)) ||
      (remote && loc.remote_anywhere && location.replace(REMOTE_ONLY, "") === "");
    return ok ? { ...job, locationMissing: false } : null;
  };
}
