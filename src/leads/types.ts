export type LeadSource = "reddit" | "hackernews" | "forum" | "freelancer" | "x" | "linkedin";

/** Someone who may need your services: a request for help, or a project post. */
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
  /** Posted somewhere that only holds requests (a forum's hiring section), so no asking verb is needed. */
  asking?: boolean;
}
