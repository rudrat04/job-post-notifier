import { createHash } from "node:crypto";
import { getJson, htmlToText } from "../../http";
import type { Lead } from "../types";

interface Project {
  id: number;
  title: string;
  seo_url: string;
  preview_description?: string;
  time_submitted: number;
  currency?: { code?: string; exchange_rate?: number };
  budget?: { minimum?: number; maximum?: number };
  bid_stats?: { bid_count?: number };
}

/** Open projects on Freelancer.com, newest first, from its public API. */
export async function searchFreelancer(
  query: string,
  dayRange: number,
  opts: { minBudgetUsd?: number; maxBids?: number } = {},
): Promise<Lead[]> {
  const params = new URLSearchParams({
    query,
    limit: "50",
    from_time: String(Math.floor(Date.now() / 1000 - dayRange * 86_400)),
    job_details: "false",
  });
  const data = await getJson<{ result?: { projects?: Project[] } }>(
    `https://www.freelancer.com/api/projects/0.1/projects/active/?${params}`,
  );
  const projects = (data.result?.projects ?? []).filter((p) => {
    const top = p.budget?.maximum ?? p.budget?.minimum ?? 0;
    const usd = top * (p.currency?.exchange_rate ?? 1);
    if (opts.minBudgetUsd && usd < opts.minBudgetUsd) return false;
    return !(opts.maxBids && (p.bid_stats?.bid_count ?? 0) > opts.maxBids);
  });
  return projects.map((p) => {
    const { minimum, maximum } = p.budget ?? {};
    const range = minimum && maximum ? `${minimum}-${maximum}` : String(maximum ?? minimum ?? "");
    return {
      id: createHash("sha1").update(`freelancer:${p.id}`).digest("hex"),
      source: "freelancer" as const,
      title: htmlToText(p.title),
      text: htmlToText(p.preview_description ?? ""),
      url: `https://www.freelancer.com/projects/${p.seo_url}`,
      postedAt: new Date(p.time_submitted * 1000).toISOString(),
      origin: p.bid_stats?.bid_count != null ? `${p.bid_stats.bid_count} bids so far` : "Freelancer.com",
      budget: range ? `${p.currency?.code ?? ""} ${range}`.trim() : undefined,
    };
  });
}
