export type Ats = "greenhouse" | "lever" | "ashby" | "workable";

export interface CompanyEntry {
  url: string;
  name?: string;
  ats?: Ats;
  slug?: string;
}

export interface ResolvedCompany {
  name: string;
  url: string;
  ats: Ats;
  slug: string;
}

export interface Job {
  /** Stable dedupe key: sha1 of ats, slug and the ATS's own job id. */
  id: string;
  externalId: string;
  company: string;
  title: string;
  location: string;
  remote: boolean;
  url: string;
  source: Ats;
  postedAt?: string;
  description?: string;
}

export interface MatchedJob extends Job {
  /** The posting had no location, so the location filter could not be applied. */
  locationMissing: boolean;
}

export interface SourceFailure {
  company: string;
  url: string;
  reason: string;
}
