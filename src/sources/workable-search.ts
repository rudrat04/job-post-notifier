import { getJson, htmlToText } from "../http";
import type { Job } from "../types";
import { contentId } from "../dedupe";

interface SearchJob {
  id: string;
  title: string;
  url: string;
  description?: string;
  requirementsSection?: string;
  created?: string;
  workplace?: string;
  locations?: string[];
  location?: { city?: string; countryName?: string };
  company?: { title?: string };
}

interface SearchPage {
  jobs: SearchJob[];
  nextPageToken?: string;
}

const MAX_PAGES = 5;

/**
 * Workable's public job search spans every company on Workable, so it finds
 * employers that aren't in companies.yaml. Results are fuzzy; the normal title
 * filter does the real matching afterwards.
 */
export async function searchWorkable(
  query: string,
  location: string,
  dayRange: number,
): Promise<Job[]> {
  const jobs: Job[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ query, location });
    if (dayRange > 0) params.set("day_range", String(Math.ceil(dayRange)));
    if (pageToken) params.set("pageToken", pageToken);
    const data = await getJson<SearchPage>(`https://jobs.workable.com/api/v1/jobs?${params}`);
    for (const j of data.jobs ?? []) {
      const place = [j.location?.city, j.location?.countryName].filter(Boolean).join(", ");
      const remote = j.workplace === "remote" || (j.locations ?? []).includes("TELECOMMUTE");
      const company = j.company?.title?.trim() || "Unknown company";
      jobs.push({
        id: contentId(company, j.title),
        externalId: j.id,
        company,
        title: j.title.trim(),
        location: remote && !/\bremote\b/i.test(place) ? `Remote${place ? ` (${place})` : ""}` : place,
        remote,
        url: j.url,
        source: "workable",
        postedAt: j.created,
        description: htmlToText(`${j.description ?? ""} ${j.requirementsSection ?? ""}`),
      });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return jobs;
}
