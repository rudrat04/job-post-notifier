import { getJson } from "../http";
import type { JobDraft } from "./index";

interface AshbyJob {
  id: string;
  title: string;
  jobUrl: string;
  location?: string;
  secondaryLocations?: { location?: string }[];
  isRemote?: boolean;
  workplaceType?: string;
  isListed?: boolean;
  publishedAt?: string;
  descriptionPlain?: string;
}

export async function fetchAshby(slug: string): Promise<JobDraft[]> {
  const data = await getJson<{ jobs: AshbyJob[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`,
  );
  return data.jobs
    .filter((j) => j.isListed !== false)
    .map((j) => {
      const location = [j.location, ...(j.secondaryLocations ?? []).map((s) => s.location)]
        .filter(Boolean)
        .join(" / ");
      return {
        externalId: j.id,
        title: j.title.trim(),
        location,
        remote: Boolean(j.isRemote) || j.workplaceType === "Remote" || /\bremote\b/i.test(location),
        url: j.jobUrl,
        postedAt: j.publishedAt,
        description: j.descriptionPlain,
      };
    });
}
