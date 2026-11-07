import { contentId } from "../dedupe";
import { htmlToText, request } from "../http";
import type { Job, Source } from "../types";

const REMOTE = /\b(?:remote|work from home|work-from-home|wfh)\b/i;

interface Raw {
  externalId: string;
  company?: string;
  title: string;
  location?: string;
  url: string;
  postedAt?: string;
  description?: string;
  remote?: boolean;
}

function toJob(source: Source, r: Raw): Job {
  const title = htmlToText(r.title);
  const company = htmlToText(r.company ?? "") || "Unknown company";
  const description = r.description ? htmlToText(r.description) : undefined;
  const location = htmlToText(r.location ?? "");
  const remote = r.remote ?? REMOTE.test(`${title} ${location} ${description ?? ""}`);
  return {
    id: contentId(company, title),
    externalId: r.externalId,
    company,
    title,
    location: remote && !REMOTE.test(location) ? `Remote${location ? ` (${location})` : ""}` : location,
    remote,
    url: r.url,
    source,
    postedAt: r.postedAt,
    description,
  };
}

// ---------------------------------------------------------------- JSearch (RapidAPI)
interface JSearchResponse {
  data?: {
    job_id: string;
    job_title: string;
    employer_name?: string;
    job_city?: string;
    job_state?: string;
    job_country?: string;
    job_is_remote?: boolean;
    job_description?: string;
    job_apply_link: string;
    job_posted_at_datetime_utc?: string;
  }[];
}

export async function searchJSearch(
  apiKey: string,
  query: string,
  where: string,
  dayRange: number,
): Promise<Job[]> {
  const params = new URLSearchParams({
    query: `${query} in ${where}`,
    page: "1",
    num_pages: "1",
    country: "in",
    date_posted: dayRange <= 1 ? "today" : dayRange <= 3 ? "3days" : "week",
  });
  // No retries: every attempt counts against the monthly quota.
  const res = await request(
    `https://jsearch.p.rapidapi.com/search?${params}`,
    { headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": "jsearch.p.rapidapi.com" } },
    0,
  );
  const data = (await res.json()) as JSearchResponse;
  return (data.data ?? []).map((r) =>
    toJob("jsearch", {
      externalId: r.job_id,
      company: r.employer_name,
      title: r.job_title,
      location: [r.job_city, r.job_state, r.job_country].filter(Boolean).join(", "),
      url: r.job_apply_link,
      postedAt: r.job_posted_at_datetime_utc,
      description: r.job_description,
      remote: r.job_is_remote,
    }),
  );
}
