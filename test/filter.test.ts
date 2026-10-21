import { describe, expect, it } from "vitest";
import { loadFilters } from "../src/config";
import { buildMatcher } from "../src/filter";
import type { Job } from "../src/types";

const filters = await loadFilters("config/filters.yaml");
const match = buildMatcher(filters);

const job = (title: string, location: string, extra: Partial<Job> = {}): Job => ({
  id: "x",
  externalId: "x",
  company: "Acme",
  source: "lever",
  url: "https://example.com",
  remote: false,
  title,
  location,
  ...extra,
});

describe("titles", () => {
  it.each([
    "Chief of Staff",
    "Chief of Staff to the CEO",
    "Founder's Office - Associate",
    "Founder’s Office",
    "Founders Office Associate",
    "Founder's Associate",
    "GTM Engineer",
    "GTM Strategy Manager",
    "GTM Operations Lead",
    "Go-To-Market Manager",
    "Product Marketing Manager",
    "Associate Product Marketing Manager",
    "PMM, Growth",
    "Revenue Operations Analyst",
    "RevOps Manager",
    "Sales Operations Associate",
    "Sales Process Architect",
    "Operations Manager, Revenue",
    "Marketing Automation Specialist",
    "Marketing Operations Manager",
    "Growth Engineer",
    "Automation Engineer, Sales",
    "Growth Operations Associate",
    "Strategy Associate",
    "HubSpot Specialist",
    "CRM Manager",
  ])("keeps %s", (title) => {
    expect(match(job(title, "Mumbai"))).not.toBeNull();
  });

  it.each([
    "Software Engineer",
    "Senior Product Marketing Manager",
    "Sr. Revenue Operations Manager",
    "Growth Marketing Intern",
    "VP Growth",
    "Head of Growth",
    "Director, Revenue Operations",
    "Staff Software Engineer",
    "Sales Engineer",
    "Solutions Engineer",
    "Product Designer",
    "Accounts Payable Manager",
    "Marketing Manager",
    "Sales Executive",
    "Business Development Manager",
    "Sales Business Development Manager",
    "Email Marketing Operations Assistant",
    "Strategic HR Business Partner",
    "Talent Partner / Founders office - TA",
    "Technical Marketing Engineer",
    "Engineer - Sales",
    "FP&A Manager – Revenue Operations",
    "Bangalore Career Fair - Sales Enablement Specialist",
  ])("drops %s", (title) => {
    expect(match(job(title, "Mumbai"))).toBeNull();
  });

  it("drops jobs asking for more than 3 years", () => {
    const d = (description: string) => match(job("RevOps Manager", "Mumbai", { description }));
    expect(d("You have 6+ years of experience in sales ops")).toBeNull();
    expect(d("5-8 years of experience")).toBeNull();
    expect(d("4 to 6 years in RevOps")).toBeNull();
    expect(d("Minimum 7 years in RevOps")).toBeNull();
    expect(d("At least 4 years")).toBeNull();
    expect(d("1-3 years of experience")).not.toBeNull();
    expect(d("2-5 years of experience")).not.toBeNull();
    expect(d("2+ years of experience")).not.toBeNull();
    expect(d("No experience stated")).not.toBeNull();
  });

  it("reads required experience from Naukri links", () => {
    const u = (url: string) => match(job("RevOps Manager", "Mumbai", { url }));
    expect(u("https://www.naukri.com/job-listings-revops-acme-mumbai-8-to-13-years-211")).toBeNull();
    expect(u("https://www.naukri.com/job-listings-revops-acme-mumbai-1-to-3-years-211")).not.toBeNull();
  });
});

describe("locations", () => {
  it.each([
    ["Mumbai", false],
    ["Pune, Maharashtra", false],
    ["Bengaluru, Karnataka", false],
    ["Bangalore", false],
    ["Mumbai, Maharashtra, India", false],
    ["Bengaluru / Mumbai", false],
    ["Remote - India", true],
    ["India (Remote)", true],
    ["Remote", true],
    ["Remote, Anywhere", true],
    ["Remote - APAC", true],
  ])("keeps %s", (location, remote) => {
    expect(match(job("Chief of Staff", location, { remote }))).not.toBeNull();
  });

  it.each([
    ["Delhi", false],
    ["Hyderabad", false],
    ["San Francisco", false],
    ["Remote (US)", true],
    ["Remote - EMEA", true],
    ["India", false],
  ])("drops %s", (location, remote) => {
    expect(match(job("Chief of Staff", location, { remote }))).toBeNull();
  });

  it("keeps and flags jobs with no location", () => {
    expect(match(job("Chief of Staff", ""))?.locationMissing).toBe(true);
  });
});

describe("recency", () => {
  const now = Date.parse("2026-10-21T12:00:00Z");
  const ago = (hours: number) => new Date(now - hours * 3_600_000).toISOString();

  it("keeps jobs inside the window", () => {
    expect(match(job("Chief of Staff", "Mumbai", { postedAt: ago(1) }), now)).not.toBeNull();
    expect(match(job("Chief of Staff", "Mumbai", { postedAt: ago(47) }), now)).not.toBeNull();
  });

  it("drops jobs older than max_age_days", () => {
    expect(match(job("Chief of Staff", "Mumbai", { postedAt: ago(49) }), now)).toBeNull();
  });

  it("keeps undated jobs when keep_undated is true", () => {
    expect(match(job("Chief of Staff", "Mumbai"), now)).not.toBeNull();
  });
});
