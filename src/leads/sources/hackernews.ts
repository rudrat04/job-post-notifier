import { createHash } from "node:crypto";
import { getJson, htmlToText } from "../../http";
import type { Lead } from "../types";

interface Hit {
  objectID: string;
  author?: string;
  created_at?: string;
  title?: string;
  story_title?: string;
  comment_text?: string;
  story_text?: string;
}

/** Hacker News posts and comments through the free Algolia search API. */
export async function searchHackerNews(query: string, dayRange: number): Promise<Lead[]> {
  const since = Math.floor(Date.now() / 1000 - dayRange * 86_400);
  const params = new URLSearchParams({
    query,
    tags: "(story,comment)",
    numericFilters: `created_at_i>${since}`,
    hitsPerPage: "50",
  });
  const data = await getJson<{ hits: Hit[] }>(`https://hn.algolia.com/api/v1/search_by_date?${params}`);
  return data.hits.map((h) => {
    const body = htmlToText(h.comment_text ?? h.story_text ?? "");
    const url = `https://news.ycombinator.com/item?id=${h.objectID}`;
    return {
      id: createHash("sha1").update(`hackernews:${h.objectID}`).digest("hex"),
      source: "hackernews" as const,
      // Comments have no title of their own: use the start of the comment.
      title: h.title ?? (body.length > 90 ? `${body.slice(0, 90)}…` : body),
      text: body,
      url,
      postedAt: h.created_at,
      origin: h.story_title ? `on "${h.story_title}"` : "Hacker News",
      author: h.author,
    };
  });
}
