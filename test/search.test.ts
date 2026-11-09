import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchConfig } from "../src/config";
import { searchJSearch } from "../src/sources/aggregators";
import { planSearches } from "../src/sources/search";

const config: SearchConfig = {
  queries: ["revops", "gtm"],
  workable: { locations: ["India"] },
  jsearch: { queries: ["revops", "gtm", "chief of staff"], where: ["India"], max_requests: 2 },
};

describe("planSearches", () => {
  it("skips keyed sources without keys and names them", () => {
    const { tasks, skipped } = planSearches(config, 2, {});
    expect(tasks).toHaveLength(2); // Workable only
    expect(skipped).toHaveLength(1);
  });

  const HALF_DAY = 12 * 3_600_000;
  const jsearchLabels = (now: number) =>
    planSearches(config, 2, { RAPIDAPI_KEY: "r" }, null, { now })
      .tasks.filter((t) => t.label.startsWith("JSearch"))
      .map((t) => t.label);

  it("caps JSearch requests per run and rotates through the queries", () => {
    expect(jsearchLabels(0)).toEqual(['JSearch "revops" in India', 'JSearch "gtm" in India']);
    expect(jsearchLabels(HALF_DAY)).toEqual(['JSearch "chief of staff" in India', 'JSearch "revops" in India']);
    expect(jsearchLabels(2 * HALF_DAY)).toEqual(['JSearch "gtm" in India', 'JSearch "chief of staff" in India']);
  });

  it("skips JSearch when told to, to save quota", () => {
    const { tasks, skipped } = planSearches(config, 2, { RAPIDAPI_KEY: "r" }, null, { jsearch: false });
    expect(tasks.some((t) => t.label.startsWith("JSearch"))).toBe(false);
    expect(skipped).toHaveLength(1);
  });
});

function mockFetch(body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("aggregator adapters", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps JSearch results", async () => {
    const fn = mockFetch({
      data: { jobs: [
        {
          job_id: "abc",
          job_title: "Chief of Staff",
          employer_name: "Gamma",
          job_city: "Bengaluru",
          job_state: "Karnataka",
          job_country: "IN",
          job_is_remote: false,
          job_description: "Support the CEO",
          job_apply_link: "https://gamma.example/apply",
          job_posted_at_datetime_utc: "2026-10-21T05:00:00Z",
        },
      ] },
    });
    const [j] = await searchJSearch("key", "chief of staff", "India", 2);
    expect(j).toMatchObject({ company: "Gamma", location: "Bengaluru, Karnataka, IN", remote: false, source: "jsearch" });
    expect(String((fn.mock.calls[0] as unknown[])[0])).toContain("jsearch.p.rapidapi.com/search-v2?");
  });

  it("returns nothing for an empty response", async () => {
    mockFetch({});
    expect(await searchJSearch("key", "x", "India", 2)).toEqual([]);
  });

  it("does not retry a failed JSearch request", async () => {
    const fn = vi.fn(async () => new Response("", { status: 429 }));
    vi.stubGlobal("fetch", fn);
    await expect(searchJSearch("key", "x", "India", 2)).rejects.toThrow("429");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("JobSpy", () => {
  it("parses JSON lines and skips bad ones", async () => {
    const { parseJobspyLines } = await import("../src/sources/jobspy");
    const jobs = parseJobspyLines(
      [
        JSON.stringify({ site: "linkedin", title: "Sales Enablement Manager", company: "Acme Pvt Ltd", location: "Mumbai Metropolitan Region", date_posted: "2026-10-21", is_remote: false, job_url: "https://linkedin.com/jobs/view/1" }),
        "not json",
        JSON.stringify({ title: "No url" }),
        JSON.stringify({ site: "naukri", title: "RevOps Lead", company: "Beta", location: "Pune", is_remote: true, job_url: "https://naukri.com/2" }),
        "",
      ].join("\n"),
    );
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({ company: "Acme Pvt Ltd", source: "jobspy", location: "Mumbai Metropolitan Region", postedAt: "2026-10-21" });
    expect(jobs[1]).toMatchObject({ remote: true, location: "Remote (Pune)" });
  });

  it("is skipped when the CLI isn't installed, planned when it is", () => {
    const cfg: SearchConfig = {
      queries: ["x"],
      jobspy: { sites: ["linkedin"], queries: ["a", "b"], where: ["Mumbai", "Pune"], remote_india: true, results_per_site: 10 },
    };
    const missing = planSearches(cfg, 2, {}, null);
    expect(missing.tasks).toHaveLength(0);
    expect(missing.skipped[0]).toMatch(/JobSpy/);
    const present = planSearches(cfg, 2, {}, "jobspy");
    expect(present.tasks).toHaveLength(6); // (2 cities + remote India) × 2 queries
    expect(present.tasks.every((t) => t.group === "jobspy")).toBe(true);
  });
});
