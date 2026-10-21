import { contentId } from "../dedupe";
import { getJson, htmlToText } from "../http";
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

// ---------------------------------------------------------------- Adzuna
interface AdzunaResponse {
  results?: {
    id: string | number;
    title: string;
    description?: string;
    created?: string;
    redirect_url: string;
    company?: { display_name?: string };
    location?: { display_name?: string };
  }[];
}

export async function searchAdzuna(
  creds: { appId: string; appKey: string },
  query: string,
  where: string,
  dayRange: number,
): Promise<Job[]> {
  const params = new URLSearchParams({
    app_id: creds.appId,
    app_key: creds.appKey,
    what: query,
    where,
    results_per_page: "50",
    sort_by: "date",
  });
  if (dayRange > 0) params.set("max_days_old", String(Math.ceil(dayRange)));
  const data = await getJson<AdzunaResponse>(`https://api.adzuna.com/v1/api/jobs/in/search/1?${params}`);
  return (data.results ?? []).map((r) =>
    toJob("adzuna", {
      externalId: String(r.id),
      company: r.company?.display_name,
      title: r.title,
      location: r.location?.display_name,
      url: r.redirect_url,
      postedAt: r.created,
      description: r.description,
    }),
  );
}

// ---------------------------------------------------------------- Jooble
interface JoobleResponse {
  jobs?: {
    id?: string | number;
    title: string;
    location?: string;
    snippet?: string;
    link: string;
    company?: string;
    updated?: string;
  }[];
}

export async function searchJooble(
  apiKey: string,
  query: string,
  where: string,
  dayRange: number,
): Promise<Job[]> {
  const body: Record<string, string> = { keywords: query, location: where, page: "1" };
  if (dayRange > 0) body.datecreatedfrom = new Date(Date.now() - dayRange * 86_400_000).toISOString().slice(0, 10);
  const data = await getJson<JoobleResponse>(`https://jooble.org/api/${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (data.jobs ?? []).map((r) =>
    toJob("jooble", {
      externalId: String(r.id ?? r.link),
      company: r.company,
      title: r.title,
      location: r.location,
      url: r.link,
      postedAt: r.updated,
      description: r.snippet,
    }),
  );
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
  const data = await getJson<JSearchResponse>(`https://jsearch.p.rapidapi.com/search?${params}`, {
    headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": "jsearch.p.rapidapi.com" },
  });
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
