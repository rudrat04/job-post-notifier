import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchConfig } from "../src/config";
import { searchAdzuna, searchJooble, searchJSearch } from "../src/sources/aggregators";
import { planSearches } from "../src/sources/search";

const config: SearchConfig = {
  queries: ["revops", "gtm"],
  workable: { locations: ["India"] },
  adzuna: { where: ["Mumbai", "Pune"] },
  jooble: { where: ["Mumbai"] },
  jsearch: { queries: ["revops", "gtm", "chief of staff"], where: ["India"], max_requests: 2 },
};

describe("planSearches", () => {
  it("skips keyed sources without keys and names them", () => {
    const { tasks, skipped } = planSearches(config, 2, {});
    expect(tasks).toHaveLength(2); // Workable only
    expect(skipped).toHaveLength(3);
  });

  it("expands queries × places and caps JSearch requests", () => {
    const env = { ADZUNA_APP_ID: "i", ADZUNA_APP_KEY: "k", JOOBLE_API_KEY: "j", RAPIDAPI_KEY: "r" };
    const { tasks, skipped } = planSearches(config, 2, env);
    expect(skipped).toEqual([]);
    expect(tasks.filter((t) => t.label.startsWith("Adzuna"))).toHaveLength(4);
    expect(tasks.filter((t) => t.label.startsWith("Jooble"))).toHaveLength(2);
    expect(tasks.filter((t) => t.label.startsWith("JSearch"))).toHaveLength(2);
  });
});

function mockFetch(body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("aggregator adapters", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps Adzuna results and sends the query", async () => {
    const fetchMock = mockFetch({
      results: [
        {
          id: 123,
          title: "<strong>RevOps</strong> Manager",
          description: "Own our CRM. Remote friendly.",
          created: "2026-10-20T10:00:00Z",
          redirect_url: "https://adzuna.in/land/123",
          company: { display_name: "Acme Pvt Ltd" },
          location: { display_name: "Mumbai, Maharashtra" },
        },
      ],
    });
    const [j] = await searchAdzuna({ appId: "i", appKey: "k" }, "revops", "Mumbai", 2);
    expect(j).toMatchObject({
      company: "Acme Pvt Ltd",
      title: "RevOps Manager",
      location: "Remote (Mumbai, Maharashtra)",
      remote: true,
      source: "adzuna",
      url: "https://adzuna.in/land/123",
    });
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toContain("/jobs/in/search/1");
    expect(url).toContain("max_days_old=2");
    expect(url).toContain("what=revops");
  });

  it("maps Jooble results", async () => {
    const fetchMock = mockFetch({
      jobs: [{ id: 9, title: "GTM Lead", location: "Pune", snippet: "Join <b>us</b>", link: "https://jooble.org/j/9", company: "Beta", updated: "2026-10-21" }],
    });
    const [j] = await searchJooble("key", "gtm", "Pune", 2);
    expect(j).toMatchObject({ company: "Beta", title: "GTM Lead", location: "Pune", source: "jooble", description: "Join us" });
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({ keywords: "gtm", location: "Pune" });
  });

  it("maps JSearch results", async () => {
    mockFetch({
      data: [
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
      ],
    });
    const [j] = await searchJSearch("key", "chief of staff", "India", 2);
    expect(j).toMatchObject({ company: "Gamma", location: "Bengaluru, Karnataka, IN", remote: false, source: "jsearch" });
  });

  it("returns nothing for an empty response", async () => {
    mockFetch({});
    expect(await searchAdzuna({ appId: "i", appKey: "k" }, "x", "Mumbai", 2)).toEqual([]);
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
