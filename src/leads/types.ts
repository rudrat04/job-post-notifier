export type LeadSource = "reddit" | "hackernews" | "freelancer" | "funding";

/** Someone who may need your services: a request for help, a project post, or a freshly funded startup. */
export interface Lead {
  /** sha1 of source + url, so a lead is only sent once. */
  id: string;
  source: LeadSource;
  title: string;
  /** Plain-text body or summary, used for matching and the email snippet. */
  text: string;
  url: string;
  postedAt?: string;
  /** Subreddit, search query or news outlet the lead came from. */
  origin?: string;
  author?: string;
  /** e.g. "USD 250-750", for marketplace projects. */
  budget?: string;
}
