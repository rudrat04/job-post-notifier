import { createHash } from "node:crypto";
import { getJson, htmlToText } from "../../http";
import type { Lead } from "../types";

interface Topic {
  id: number;
  title: string;
  slug: string;
  excerpt?: string;
  created_at: string;
  pinned?: boolean;
  posters?: unknown[];
}

/**
 * Newest topics in a Discourse category, e.g. https://community.n8n.io/c/jobs/13.
 * The topic list already carries an excerpt of the first post, so one request per forum.
 */
export async function searchForum(name: string, categoryUrl: string): Promise<Lead[]> {
  const base = categoryUrl.replace(/\/+$/, "");
  const origin = new URL(base).origin;
  const data = await getJson<{ topic_list?: { topics?: Topic[] } }>(`${base}.json?order=created`);
  return (data.topic_list?.topics ?? [])
    // n8n closes job posts to replies straight away, so closed topics still count.
    .filter((t) => !t.pinned)
    .map((t) => ({
      id: createHash("sha1").update(`forum:${origin}:${t.id}`).digest("hex"),
      source: "forum" as const,
      title: htmlToText(t.title),
      text: htmlToText(t.excerpt ?? ""),
      url: `${origin}/t/${t.slug}/${t.id}`,
      postedAt: t.created_at,
      origin: name,
      asking: true,
    }));
}
