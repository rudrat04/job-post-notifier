import { describe, expect, it } from "vitest";
import { loadFoundersConfig } from "../src/founders/config";
import { buildFoundersDigest } from "../src/founders/email";
import { companiesFromNews, companyFromHeadline, parseNewsFeed } from "../src/founders/funding";
import { exaFounders, exaRoleHolders, sameCompany, type ExaPerson } from "../src/founders/exa";
import { pdlPhrase, pdlQuery } from "../src/founders/pdl";
import { atCompany, foundersIn, parseProfile, roleHoldersIn, rolePattern, roleQuery } from "../src/founders/linkedin";

const config = await loadFoundersConfig("config/founders.yaml");
const roles = rolePattern(config.roles);

describe("company from a funding headline", () => {
  it.each([
    ["Maasi Raises ₹6 Crore in Pre-Seed Funding", "Maasi"],
    ["Child-care startup Maasi raises Rs 6 Cr in pre-seed round", "Maasi"],
    ["Child-Care Startup Maasi Raises Rs 6 Cr", "Maasi"],
    ["Bucketlistt.com Raises ₹7.6 Crore Seed Funding", "Bucketlistt"],
    ["From Rishikesh rafting to Manali: Bucketlistt raises Rs 7.6 crore", "Bucketlistt"],
    ["Nova Spectral AI Raises Rs 21.15 Crore", "Nova Spectral AI"],
    ["Bengaluru-based SaaS startup Acme Pay secures $3M in Series A", "Acme Pay"],
    ["Sequoia-backed fintech Zolve bags $10 million", "Zolve"],
    ["India's Kapture raises funding", "Kapture"],
    ["Specialty chemicals startup altM raises $10.3 Mn in Series A Funding", "altM"],
    ["Kerala startup mistEO raises Rs 18 crore", "mistEO"],
    ["[Update] Greenjoules Closes Series B Round At ₹150 Cr", "Greenjoules"],
  ])("%s → %s", (title, name) => {
    expect(companyFromHeadline(title)).toBe(name);
  });

  it.each(["Indian startups raised $200M this week", "Startup raises funding", "Funding news of the day"])("no name in %s", (title) => {
    expect(companyFromHeadline(title)).toBeNull();
  });

  it("keeps one entry per company, newest first", () => {
    const xml = `<rss><channel>
      <item><title>Maasi raises ₹6 Cr pre-seed funding - ET</title><link>https://n/1</link><pubDate>Mon, 16 Nov 2026 08:00:00 GMT</pubDate></item>
      <item><title>Child-care startup Maasi raises Rs 6 Cr - Inc42</title><link>https://n/2</link><pubDate>Tue, 17 Nov 2026 08:00:00 GMT</pubDate></item>
      <item><title>Zolve bags $10 million - YourStory</title><link>https://n/3</link><pubDate>Sun, 15 Nov 2026 08:00:00 GMT</pubDate></item>
    </channel></rss>`;
    expect(companiesFromNews(parseNewsFeed(xml)).map((c) => [c.name, c.url])).toEqual([
      ["Maasi", "https://n/2"],
      ["Zolve", "https://n/3"],
    ]);
  });
});

const r = (title: string, snippet = "", link = "https://in.linkedin.com/in/someone") => ({ title, snippet, link });

describe("LinkedIn results", () => {
  it("parses a profile title", () => {
    expect(parseProfile(r("Priya Shah, CFA - Co-Founder & CEO - Acme | LinkedIn", "", "https://in.linkedin.com/in/priya?trk=x"))).toEqual({
      name: "Priya Shah",
      headline: "Co-Founder & CEO - Acme",
      url: "https://www.linkedin.com/in/priya",
    });
    expect(parseProfile(r("Acme | LinkedIn", "", "https://www.linkedin.com/company/acme"))).toBeNull();
  });

  it("only counts people placed at the company", () => {
    expect(atCompany(r("Priya Shah - Co-Founder - Acme | LinkedIn"), "Acme")).toBe(true);
    expect(atCompany(r("Priya Shah - Founder & CEO at Acme Technologies | LinkedIn"), "Acme")).toBe(true);
    expect(atCompany(r("Priya Shah - Investor", "Experience: Acme · Location: Bengaluru"), "Acme")).toBe(true);
    expect(atCompany(r("Priya Shah - Founder - Acme Pay | LinkedIn"), "Acme")).toBe(false);
    expect(atCompany(r("Priya Shah - Founder - Zeta", "Loves acme-grade coffee"), "Acme")).toBe(false);
    // Real snippets: the company follows the role as its own sentence.
    expect(atCompany(r("Vaishnavi Kant - SRCC'28/29 | NTPC", "Founder's Office Intern. Arborum Labs. Sep 2026 - Nov 2026 3 months."), "Arborum Labs")).toBe(true);
    expect(atCompany(r("Anamaya Shah - Entrepreneur & Chief of Staff | 0→1 Builder | ...", "Olyv. Jun 2025 - Present 1 year 6 months."), "Olyv")).toBe(true);
    expect(atCompany(r("Prashant Rana - Founder and CEO", "Inconel Technologies. Up 5 per cent this year"), "Cent")).toBe(false);
  });

  it("finds founders and ignores Founder's Office titles and past founders", () => {
    const results = [
      r("Priya Shah - Co-Founder - Acme | LinkedIn", "", "https://www.linkedin.com/in/priya"),
      r("Rahul Verma - Founder's Office - Acme | LinkedIn", "", "https://www.linkedin.com/in/rahul"),
      r("Anil Rao - Product - Acme | LinkedIn", "ex-founder of Zeta. Product at Acme", "https://www.linkedin.com/in/anil"),
      r("Meera Iyer - Founder - Acme | LinkedIn", "", "https://www.linkedin.com/in/meera"),
    ];
    expect(foundersIn(results, "Acme", 3).map((p) => p.name)).toEqual(["Priya Shah", "Meera Iyer"]);
    expect(foundersIn([r("Bishal Jaiswal - Building Arborum Labs | Leading AI for ...", "Bishal Jaiswal. Building Arborum Labs.")], "Arborum Labs", 3)).toHaveLength(1);
  });

  it("spots people already in the roles", () => {
    const results = [
      r("Rahul Verma - Founder's Office - Acme | LinkedIn", "", "https://www.linkedin.com/in/rahul"),
      r("Sara Khan - Chief of Staff to CEO at Acme | LinkedIn", "", "https://www.linkedin.com/in/sara"),
      r("Dev Patel - Sales - Acme | LinkedIn", "Former Chief of Staff at Zeta", "https://www.linkedin.com/in/dev"),
      r("Ira Sen - GTM Engineer - Zeta | LinkedIn", "", "https://www.linkedin.com/in/ira"),
    ];
    expect(roleHoldersIn(results, "Acme", roles)).toEqual(["Rahul Verma (Founder's Office)", "Sara Khan (Chief of Staff)"]);
  });

  it("matches role spellings loosely", () => {
    for (const t of ["Founders Office", "founder’s office", "GTM-Engineer", "Product Marketing Manager", "Associate to the Founder"])
      expect(roles.test(t)).toBe(true);
    expect(roles.test("Founder")).toBe(false);
  });

  it("sends Google only the phrases that add something", async () => {
    const { searchPhrases } = await import("../src/founders/linkedin");
    const phrases = searchPhrases(config.roles);
    expect(phrases).toContain("Founder's Office");
    expect(phrases).not.toContain("Founders Office");
    expect(phrases).not.toContain("Product Marketing Manager");
    expect(phrases).toContain("GTM Engineering"); // a different exact phrase from "GTM Engineer"
  });

  it("cuts the Google role search to fit its word limit, most important first", () => {
    const q = roleQuery("Acme", config.roles);
    expect(q).toMatch(/^site:linkedin\.com\/in "Acme" \("Founder's Office" OR "Chief of Staff" OR "GTM Engineer"/);
    expect(q.split(/\s+/).length).toBeLessThanOrEqual(30);
  });

  it("builds the role search", () => {
    expect(roleQuery("Acme", ["Chief of Staff", "Founder's Office"])).toBe('site:linkedin.com/in "Acme" ("Chief of Staff" OR "Founder\'s Office")');
  });
});

const person = (name: string, jobs: [title: string, company: string, to: string | null][]): ExaPerson => ({
  title: name,
  url: `https://linkedin.com/in/${name.toLowerCase().replace(/ /g, "-")}`,
  entities: [{ properties: { name, workHistory: jobs.map(([title, company, to]) => ({ title, company: { name: company }, dates: { from: "2024-01-01", to } })) } }],
});

describe("Exa people", () => {
  // Shapes taken from real Exa "people" results.
  const people = [
    person("Satvik Kapoor", [["Co-founder & CEO", "Morsa", null], ["Software Engineer", "Gander", "2025-11-01"]]),
    person("Carlo Doroff", [["Founding GTM Lead", "Morsa", null], ["Founder & CEO", "Craze", null]]),
    person("Vardaan Taneja", [["Co-Founder", "Morse Inc.", "2025-12-01"]]),
    person("Old Founder", [["Co-Founder", "Morsa", "2025-06-01"]]),
    person("Sergei Petrov", [["Co-Founder & CTO", "Morsa", null]]),
  ];

  it("finds current founders at the company only", () => {
    expect(exaFounders(people, "Morsa", 3)).toEqual([
      { name: "Satvik Kapoor", headline: "Co-founder & CEO - Morsa", url: "https://www.linkedin.com/in/satvik-kapoor" },
      { name: "Sergei Petrov", headline: "Co-Founder & CTO - Morsa", url: "https://www.linkedin.com/in/sergei-petrov" },
    ]);
  });

  it("treats a Founder/CEO office title as a role holder, not a founder", () => {
    const giva = [person("Rishi Singh", [["SVP - Strategic Initiatives and Founder/CEO office", "GIVA", null]])];
    expect(exaFounders(giva, "GIVA", 3)).toEqual([]);
    expect(exaRoleHolders(giva, "GIVA", roles)).toHaveLength(1);
  });

  it("spots current role holders, not their other jobs", () => {
    expect(exaRoleHolders(people, "Morsa", roles)).toEqual(["Carlo Doroff (Founding GTM Lead)"]);
    const olyv = [person("Anamaya Shah", [["Founders Office - Strategy | IR | Fundraising", "Olyv India (formerly SmartCoin)", null]])];
    expect(exaRoleHolders(olyv, "Olyv", roles)).toEqual(["Anamaya Shah (Founders Office - Strategy | IR | Fundraising)"]);
    expect(exaRoleHolders([person("Jasmine Chye", [["Chief of Staff", "Paradigm", null]])], "Olyv", roles)).toEqual([]);
  });

  it("matches company names with suffixes", () => {
    expect(sameCompany("Olyv India (formerly SmartCoin)", "Olyv")).toBe(true);
    expect(sameCompany("Acme Technologies Pvt. Ltd.", "Acme")).toBe(true);
    expect(sameCompany("Morse Inc.", "Morsa")).toBe(false);
  });
});

describe("PDL", () => {
  it("builds a current-job search on company and titles", () => {
    expect(pdlPhrase("Founder's Office")).toBe("founders office");
    expect(pdlQuery("Olyv", ["chief of staff"])).toEqual({
      size: 1,
      query: { bool: { must: [{ term: { job_company_name: "olyv" } }, { bool: { should: [{ match_phrase: { job_title: "chief of staff" } }] } }] } },
    });
  });
});

describe("founders email", () => {
  it("lists founders with LinkedIn links", () => {
    const d = buildFoundersDigest(
      [
        {
          company: { name: "Acme", headline: "Acme raises $2M", url: "https://n/1" },
          founders: [{ name: "Priya Shah", headline: "Co-Founder - Acme", url: "https://www.linkedin.com/in/priya" }],
        },
      ],
      config.roles,
      ["3 more companies wait for the next run."],
    );
    expect(d.subject).toMatch(/^1 startup to DM/);
    expect(d.text).toContain("Priya Shah (Co-Founder - Acme): https://www.linkedin.com/in/priya");
    expect(d.text).toContain("linkedin.com/search/results/companies/?keywords=Acme");
    expect(d.html).toContain("3 more companies wait");
  });
});
