import { decodeEntities, getJson, htmlToText } from "../http";
import type { JobDraft } from "./index";

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  first_published?: string;
  updated_at?: string;
  content?: string;
}

export async function fetchGreenhouse(slug: string): Promise<JobDraft[]> {
  const data = await getJson<{ jobs: GreenhouseJob[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`,
  );
  return data.jobs.map((j) => {
    const location = j.location?.name?.trim() ?? "";
    return {
      externalId: String(j.id),
      title: j.title.trim(),
      location,
      remote: /\bremote\b/i.test(location),
      url: j.absolute_url,
      postedAt: j.first_published ?? j.updated_at,
      // Greenhouse entity-escapes the HTML, so decode before stripping tags.
      description: j.content ? htmlToText(decodeEntities(j.content)) : undefined,
    };
  });
}
