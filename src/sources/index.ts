import { createHash } from "node:crypto";
import type { Ats, Job, ResolvedCompany } from "../types";
import { fetchAshby } from "./ashby";
import { fetchGreenhouse } from "./greenhouse";
import { fetchLever } from "./lever";
import { fetchWorkable } from "./workable";

export type JobDraft = Omit<Job, "id" | "company" | "source">;

const ADAPTERS: Record<Ats, (slug: string) => Promise<JobDraft[]>> = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
  workable: fetchWorkable,
};

export function jobId(ats: Ats, slug: string, externalId: string): string {
  return createHash("sha1").update(`${ats}:${slug.toLowerCase()}:${externalId}`).digest("hex");
}

export async function fetchJobs(company: ResolvedCompany): Promise<Job[]> {
  const drafts = await ADAPTERS[company.ats](company.slug);
  return drafts.map((d) => ({
    ...d,
    id: jobId(company.ats, company.slug, d.externalId),
    company: company.name,
    source: company.ats,
  }));
}
