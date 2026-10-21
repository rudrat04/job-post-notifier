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
    "GTM Lead",
    "Go-To-Market Manager",
    "Growth Manager",
    "Associate, Growth",
  ])("keeps %s", (title) => {
    expect(match(job(title, "Mumbai"))).not.toBeNull();
  });

  it.each([
    "Growth Engineer",
    "Software Engineer",
    "Growth Marketing Intern",
    "VP Growth",
    "Head of Growth",
    "Product Designer",
    "Accounts Payable Manager",
  ])("drops %s", (title) => {
    expect(match(job(title, "Mumbai"))).toBeNull();
  });
});

describe("locations", () => {
  it.each([
    ["Mumbai", false],
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
    ["Bengaluru", false],
    ["Delhi", false],
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
