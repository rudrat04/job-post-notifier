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

export function buildMatcher(filters: Filters) {
  const titles = anyOf(filters.titles)!;
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

    if (!titles.test(title)) return null;
    if (excludeTitle?.test(title)) return null;
    if (excludeDesc?.test(desc)) return null;
    if (include && !include.test(title) && !include.test(desc)) return null;

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
