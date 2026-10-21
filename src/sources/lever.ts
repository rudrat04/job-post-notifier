import { getJson, htmlToText } from "../http";
import type { JobDraft } from "./index";

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt?: number;
  workplaceType?: "remote" | "onsite" | "hybrid" | "unspecified";
  categories?: { location?: string; allLocations?: string[] };
  descriptionPlain?: string;
  lists?: { text: string; content: string }[];
  additionalPlain?: string;
}

export async function fetchLever(slug: string): Promise<JobDraft[]> {
  const data = await getJson<LeverJob[]>(
    `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`,
  );
  return data.map((j) => {
    const locations = j.categories?.allLocations?.length
      ? j.categories.allLocations
      : [j.categories?.location ?? ""];
    const location = locations.filter(Boolean).join(" / ");
    const description = [
      j.descriptionPlain,
      ...(j.lists ?? []).map((l) => `${l.text} ${htmlToText(l.content)}`),
      j.additionalPlain,
    ]
      .filter(Boolean)
      .join(" ");
    return {
      externalId: j.id,
      title: j.text.trim(),
      location,
      remote: j.workplaceType === "remote" || /\bremote\b/i.test(location),
      url: j.hostedUrl,
      postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
      description: description || undefined,
    };
  });
}
