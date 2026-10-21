import { getJson, htmlToText } from "../http";
import type { JobDraft } from "./index";

interface WorkableJob {
  shortcode: string;
  title: string;
  url: string;
  telecommuting?: boolean;
  city?: string;
  country?: string;
  locations?: { city?: string; region?: string; country?: string; hidden?: boolean }[];
  published_on?: string;
  description?: string;
}

function place(l: { city?: string; region?: string; country?: string }): string {
  return [l.city, l.region, l.country].filter(Boolean).join(", ");
}

export async function fetchWorkable(slug: string): Promise<JobDraft[]> {
  const data = await getJson<{ jobs: WorkableJob[] }>(
    `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}?details=true`,
  );
  return data.jobs.map((j) => {
    const visible = (j.locations ?? []).filter((l) => !l.hidden).map(place).filter(Boolean);
    const location = visible.length ? visible.join(" / ") : place(j);
    const remote = Boolean(j.telecommuting);
    return {
      externalId: j.shortcode,
      title: j.title.trim(),
      location: remote && !/\bremote\b/i.test(location) ? `Remote${location ? ` (${location})` : ""}` : location,
      remote,
      url: j.url,
      postedAt: j.published_on,
      description: j.description ? htmlToText(j.description) : undefined,
    };
  });
}
