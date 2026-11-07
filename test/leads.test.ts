import { afterEach, describe, expect, it, vi } from "vitest";
import { loadLeadsConfig } from "../src/leads/config";
import { buildLeadsDigest } from "../src/leads/email";
import { buildLeadMatcher } from "../src/leads/filter";
import { searchFreelancer } from "../src/leads/sources/freelancer";
import { dedupeFunding, parseNewsFeed } from "../src/leads/sources/funding";
import { batchQueries, parseRedditFeed } from "../src/leads/sources/reddit";
import type { Lead } from "../src/leads/types";

const config = await loadLeadsConfig("config/leads.yaml");
const match = buildLeadMatcher(config);

const lead = (title: string, text = "", over: Partial<Lead> = {}): Lead => ({
  id: title,
  source: "reddit",
  title,
  text,
  url: "https://example.com",
  postedAt: new Date().toISOString(),
  ...over,
});

describe("lead filter", () => {
  it.each([
    ["Need a HubSpot expert to set up our CRM", ""],
    ["Can anyone recommend a freelancer for GTM strategy?", ""],
    ["Looking for a freelance RevOps consultant", ""],
    ["Rahul on X", "Looking for an outbound sales expert to fix our pipeline"],
    ["Automation expert needed for our D2C brand", ""],
    ["Looking for someone to build n8n workflows for our sales team", ""],
    ["Need a Zapier expert to connect Shopify and our CRM", ""],
    ["Looking for a fractional GTM engineer for our B2B SaaS", ""],
    ["Need someone to set up a WhatsApp chatbot for our store", ""],
    ["Need help building an n8n workflow, will pay", ""],
    ["Looking for help automating our lead routing in HubSpot (paid)", ""],
    ["Need help with Clay for outbound", "Budget $500"],
    ["[Hiring] RevOps consultant, Mumbai", ""],
    ["Seeking a GTM consultant for our B2B SaaS", ""],
    ["Marketing help", "We are looking for an agency to run outbound campaigns for us. Budget is flexible."],
  ])("keeps %s", (title, text) => {
    expect(match(lead(title, text))).toBe(true);
  });

  it.each([
    ["[For Hire] Web developer, portfolio inside", "I build websites"],
    ["Need a Website for Your Business? We're offering development starting at ₹1,699!", ""],
    ["I build web apps and simple websites for startups", ""],
    ["Looking for a part-time BDE / Growth role", ""],
    ["Looking for Founder's Office / GTM opportunities in Bangalore", ""],
    ["Looking for a brand + marketing co-founder", ""],
    ["Show HN: my open-source landing page builder", ""],
    ["At what point does changing your ICP become an excuse?", "Product decisions are hard."],
    ["How do you preempt the 'X already does that' reaction?", ""],
    ["I'm a freelance web designer open to work", ""],
    ["Need a ride to the polls? This website can help", "Find your polling place"],
    ["Clay Travis on X", "Need a break from the noise? Looking for an outbound edge in football picks"],
    ["Need a tutor", "for b2b sales classes"],
    ["Looking for affordable shared WordPress hosting", ""],
    ["Francisc Toth's Post", "Founders ask me every month: Do I need a web designer or a web developer?"],
    ["Hridoy Reh", "Claude will recommend your website. 1. Visit the submit-url page. 2. Enter your website URL."],
    ["European Centre for Press and Media Freedom", "We need support with the content behind it. We're looking for a website content management internship"],
    ["Katie Schwartz posted this", "They're hiring a GTM Associate right now! Looking for someone analytical."],
    ["Tracking completed meetings in HubSpot", "I need to see which calls were completed in the CRM"],
    ["Radish's Post", "We're actively looking for our next HubSpot specialist. Join our team! #hiring"],
    ["If I started my cleaning business from scratch, this is how I'd get clients", ""],
    ["Need help with n8n HTTP node error", "My workflow keeps failing with 401"],
    ["Need help: Zapier zap not triggering", ""],
    ["Help needed with HubSpot workflow enrollment", "Contacts are not enrolling"],
    ["Which automation tool should I use?", "Need advice on Zapier vs Make"],
    ["Looking to build a free AI automation for a few businesses", ""],
    ["Foundry's Post", "We're hiring across our global teams, with opportunities in sales, RevOps and more. Looking for RevOps leaders"],
  ])("drops %s", (title, text) => {
    expect(match(lead(title, text))).toBe(false);
  });

  it("drops the 'Need a website? We're offering…' advert, full and truncated", () => {
    const body = `Whether you need an e-commerce store or a simple website to showcase your business, we can help you get started.
      Types of websites we can build: E-commerce Websites, Business & Startup Websites, Landing Pages.
      Starting Price: Just ₹1,699. Want to take your business online without spending a fortune? Interested?
      Comment "WEBSITE" below, or DM me "WEBSITE" to discuss your requirements. Let's turn your idea into a website!`;
    expect(match(lead("Need a Website for Your Business or Personal Brand? We’re offering website development services starting at just ₹1,699!", body))).toBe(false);
    // Search engines cut the title short, so the offer must be caught from the text.
    expect(match(lead("Need a Website for Your Business or Personal Brand? We' ...", "Whether you need an e-commerce store or a simple website to showcase your business, we can help you get started."))).toBe(false);
    expect(match(lead("Need a website built?", "Quick turnaround. Starting at $99. DM me to book a call."))).toBe(false);
  });

  it("keeps a real request that talks about my own business", () => {
    expect(match(lead("Need an automation person for my SaaS", "I run a small B2B SaaS and need someone to automate our lead routing in HubSpot. Budget around $400. Please share past work."))).toBe(true);
  });

  it("drops leads older than max_age_days", () => {
    const old = new Date(Date.now() - 4 * 86_400_000).toISOString();
    expect(match(lead("Looking for a HubSpot consultant", "", { postedAt: old }))).toBe(false);
  });

  const forum = (title: string, text = "") => lead(title, text, { source: "forum", asking: true });

  it.each([
    ["Looking to Hire an n8n Expert to Build a Lead Management Automation Workflow", ""],
    ["Looking for n8n contractors for ongoing project work", ""],
    ["Make freelancer needed for project", "I need a scenario that syncs Typeform to Airtable"],
    ["Need help regarding n8n AI assistant and workflow. Please help i can pay you", ""],
    ["Hiring in San Diego (n8n & hubspot)", "Contract work for a local agency"],
  ])("keeps forum post %s", (title, text) => {
    expect(match(forum(title, text))).toBe(true);
  });

  it.each([
    ["Shopify Store Owners: We're Offering a 14-Day FREE Trial of tResolv!", ""],
    ["Looking for referral and sales partners for n8n & AI automation (B2B: Revenue Share)", ""],
    ["Volunteer AI ambassadors and advisers wanted (AI agents and operators)", ""],
    ["[HIRING] Full-Time Close CRM & n8n Automation Engineer | Remote", "We're looking for a long-term team member, full-time."],
    ["Hire a Make.com Expert for AI Automation, AI Agents and Ops Systems", ""],
    ["Automate your workflow with an AI specialist", ""],
    ["FREE Help for Make.com Users Facing Errors, Broken Scenarios", ""],
    ["Need help with a Make scenario or workflow automation?", "I can help you build and fix scenarios. Message me."],
    ["When does it actually make sense to put an AI agent on top of your Make scenarios?", "A lot of people assume adding AI to their automations will fix everything"],
    ["Looking for White-Label Make.com Automation Developers (Agency Partner)", ""],
    ["Weekly community call", "Talk about n8n with the team"],
  ])("drops forum post %s", (title, text) => {
    expect(match(forum(title, text))).toBe(false);
  });

  it("keeps funding stories without an intent check", () => {
    expect(match(lead("Maasi raises ₹6 Cr in pre-seed", "", { source: "funding" }))).toBe(true);
  });
});

describe("funding", () => {
  const f = (title: string): Lead => lead(title, "", { source: "funding" });

  it("collapses the same round reported by several outlets", () => {
    const kept = dedupeFunding([
      f("Maasi Raises ₹6 Crore in Pre-Seed Funding"),
      f("Child-care startup Maasi raises Rs 6 Cr in pre-seed round"),
      f("Bucketlistt.com Raises ₹7.6 Crore Seed Funding"),
      f("From Rishikesh rafting to Manali: Bucketlistt raises Rs 7.6 crore"),
      f("Nova Spectral AI Raises Rs 21.15 Crore"),
      f("Cent Raises $15 Million in Series A"),
    ]);
    expect(kept.map((l) => l.title)).toEqual([
      "Maasi Raises ₹6 Crore in Pre-Seed Funding",
      "Bucketlistt.com Raises ₹7.6 Crore Seed Funding",
      "Nova Spectral AI Raises Rs 21.15 Crore",
      "Cent Raises $15 Million in Series A",
    ]);
  });

  it("parses a Google News feed and strips the outlet suffix", () => {
    const xml = `<rss><channel><item><title>Maasi raises ₹6 Cr pre-seed funding - ET Entrepreneur</title>
      <link>https://news.example/1</link><pubDate>Tue, 27 Oct 2026 08:00:00 GMT</pubDate>
      <source url="https://et.example">ET Entrepreneur</source></item></channel></rss>`;
    const [l] = parseNewsFeed(xml);
    expect(l).toMatchObject({ title: "Maasi raises ₹6 Cr pre-seed funding", origin: "ET Entrepreneur", source: "funding" });
  });
});

describe("reddit", () => {
  it("parses an Atom search feed", () => {
    const xml = `<feed><entry><title>Need a webflow developer</title><link href="https://reddit.com/r/forhire/1"/>
      <updated>2026-10-27T10:00:00+00:00</updated><author><name>/u/alice</name></author>
      <category term="forhire" label="r/forhire"/><content type="html">&lt;p&gt;Budget $500&lt;/p&gt;</content></entry></feed>`;
    const [l] = parseRedditFeed(xml);
    expect(l).toMatchObject({ title: "Need a webflow developer", author: "alice", origin: "r/forhire", text: "Budget $500" });
  });

  it("batches queries into OR searches", () => {
    expect(batchQueries(["website", "landing page", "GTM", "RevOps", "HubSpot"], 4)).toEqual([
      'website OR "landing page" OR GTM OR RevOps',
      "HubSpot",
    ]);
  });
});

describe("freelancer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("drops tiny budgets and crowded projects", async () => {
    const p = (id: number, max: number, bids: number, rate = 1) => ({
      id,
      title: `Project ${id}`,
      seo_url: `web/p${id}`,
      preview_description: "Need a website",
      time_submitted: Math.floor(Date.now() / 1000),
      currency: { code: "USD", exchange_rate: rate },
      budget: { minimum: 1, maximum: max },
      bid_stats: { bid_count: bids },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ result: { projects: [p(1, 500, 10), p(2, 5, 3), p(3, 500, 200), p(4, 20000, 5, 0.012)] } }))),
    );
    const leads = await searchFreelancer("website", 2, { minBudgetUsd: 150, maxBids: 60 });
    expect(leads.map((l) => l.title)).toEqual(["Project 1", "Project 4"]); // 20,000 INR ≈ $240
    expect(leads[0]).toMatchObject({ budget: "USD 1-500", url: "https://www.freelancer.com/projects/web/p1" });
  });
});

describe("leads email", () => {
  it("groups by platform and reports failures", () => {
    const d = buildLeadsDigest(
      [lead("Need a landing page", "Budget $300", { origin: "r/forhire" }), lead("Maasi raises", "", { source: "funding" })],
      ["Reddit (HTTP 429)"],
    );
    expect(d.subject).toMatch(/^2 new freelance leads/);
    expect(d.text).toContain("Reddit: people asking for help");
    expect(d.text).toContain("Newly funded startups");
    expect(d.text).toContain("Couldn't check: Reddit (HTTP 429)");
    expect(d.html).toContain("Need a landing page");
  });
});

describe("web search", () => {
  it("keeps only the post's own text from a Google snippet", async () => {
    const { ownText } = await import("../src/leads/sources/websearch");
    expect(ownText("hey does anyone know the cost for a 4 page site? · I need a website developer ...")).toBe("hey does anyone know the cost for a 4 page site?");
    expect(ownText("Looking for a creative web designer. Please reach out | 119 comments on LinkedIn.")).toBe("Looking for a creative web designer. Please reach out");
    expect(ownText("Looking to build a free AI automation. Looking for Ai automation consultants [Paid work]. 47. 122. Looking for an AI")).toBe(
      "Looking to build a free AI automation. Looking for Ai automation consultants [Paid work]",
    );
    expect(ownText("What does your stack look like? When does a startup need a CTO? 4 ... Looking for a full-stack developer")).toBe(
      "What does your stack look like? When does a startup need a CTO?",
    );
    expect(ownText("Plain text with no markers")).toBe("Plain text with no markers");
  });

  it("builds one query per platform and group", async () => {
    const { buildQuery } = await import("../src/leads/sources/websearch");
    expect(buildQuery("reddit", ["looking for", "seeking"], ["website", "landing page"])).toBe(
      'site:reddit.com ("looking for" OR seeking) (website OR "landing page")',
    );
    expect(buildQuery("x", ["seeking"], ["GTM"])).toBe("(site:x.com OR site:twitter.com) (seeking) (GTM)");
    expect(buildQuery("linkedin", ["seeking"], ["GTM"])).toContain("site:linkedin.com/posts");
  });

  it("reads Google's relative and absolute dates", async () => {
    const { parseResultDate } = await import("../src/leads/sources/websearch");
    const now = Date.parse("2026-10-27T12:00:00Z");
    expect(parseResultDate("3 hours ago", now)).toBe("2026-10-27T09:00:00.000Z");
    expect(parseResultDate("2 days ago", now)).toBe("2026-10-25T12:00:00.000Z");
    expect(parseResultDate("Oct 26, 2026", now)).toMatch(/^2026-10-2[56]/);
    expect(parseResultDate(undefined, now)).toBeUndefined();
    expect(parseResultDate("whenever", now)).toBeUndefined();
  });

  it("drops LinkedIn posts whose link shows they are job ads", async () => {
    const { searchWeb } = await import("../src/leads/sources/websearch");
    const post = (slug: string) => ({ title: "Post", link: `https://www.linkedin.com/posts/${slug}-activity-1`, snippet: "Looking for a HubSpot consultant" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ organic: [post("acme_hiring-businessdevelopment-salesjobs"), post("jane_need-a-hubspot-consultant")] })),
      ),
    );
    const leads = await searchWeb("linkedin", "q", 1, 10, { SERPER_API_KEY: "k" });
    vi.unstubAllGlobals();
    expect(leads.map((l) => l.url)).toEqual(["https://www.linkedin.com/posts/jane_need-a-hubspot-consultant-activity-1"]);
  });

  it("keeps real posts, drops profile and wiki pages, and reuses the Reddit RSS id", async () => {
    const { searchWeb } = await import("../src/leads/sources/websearch");
    const { redditLeadId } = await import("../src/leads/sources/reddit");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            organic: [
              { title: "Need a website built : r/website", link: "https://www.reddit.com/r/website/comments/1xf63in/i_need_a_website_built/", snippet: "Looking for a developer", date: "3 hours ago" },
              { title: "r/FortniteBR", link: "https://www.reddit.com/r/FortniteBR/" },
              { title: "Wiki", link: "https://www.reddit.com/r/x/wiki/index/" },
            ],
          }),
        ),
      ),
    );
    const leads = await searchWeb("reddit", "q", 1, 10, { SERPER_API_KEY: "k" });
    vi.unstubAllGlobals();
    expect(leads).toHaveLength(1);
    expect(leads[0].title).toBe("Need a website built");
    expect(leads[0].id).toBe(redditLeadId("https://www.reddit.com/r/website/comments/1xf63in/"));
    expect(leads[0].origin).toBe("r/website");
  });

  it("falls back to SerpApi when Serper fails", async () => {
    const { searchWeb } = await import("../src/leads/sources/websearch");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("nope", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ organic_results: [{ title: "Seeking GTM help", link: "https://x.com/someone/status/12345?s=20", snippet: "seeking a GTM consultant", date: "1 day ago" }] })),
      );
    vi.stubGlobal("fetch", fetchMock);
    const leads = await searchWeb("x", "q", 1, 10, { SERPER_API_KEY: "a", SERPAPI_KEY: "b" });
    vi.unstubAllGlobals();
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ source: "x", url: "https://x.com/someone/status/12345" });
  });
});
