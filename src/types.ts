export type Ats = "greenhouse" | "lever" | "ashby" | "workable";
/** Where a job came from: an employer's own job board, or a keyword-search aggregator. */
export type Source = Ats | "jsearch" | "jobspy";

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
  /** Dedupe key: sha1 of company + title (see dedupe.ts), the same across every source. */
  id: string;
  externalId: string;
  company: string;
  title: string;
  location: string;
  remote: boolean;
  url: string;
  source: Source;
  postedAt?: string;
  description?: string;
}

export interface MatchedJob extends Job {
  /** The posting had no location, so the location filter could not be applied. */
  locationMissing: boolean;
  /** A freelance, contract or fractional role, listed in its own section. */
  freelance?: boolean;
}

export interface SourceFailure {
  company: string;
  url: string;
  reason: string;
}
