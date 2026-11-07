import { afterEach, describe, expect, it, vi } from "vitest";
import { dropChains, loadProspectsConfig, planSearches } from "../src/prospects/config";
import { buildProspectsDigest } from "../src/prospects/email";
import { fieldMask, type Place, textSearch } from "../src/prospects/places";
import { readSite, scoreProspect, type SiteFacts } from "../src/prospects/score";
import { createBudget } from "../src/prospects/usage";

const config = await loadProspectsConfig("config/prospects.yaml");

describe("budget", () => {
  it("stays far under Google's 1,000 free requests a month", () => {
    expect(config.budget.max_requests_per_month).toBeLessThanOrEqual(300);
    // Five weekly runs in the longest month must fit the monthly cap.
    expect(config.budget.max_requests_per_run * 5).toBeLessThanOrEqual(config.budget.max_requests_per_month);
  });

  it("stops at the per-run limit and persists each request before it is made", async () => {
    const saved: number[] = [];
    const b = createBudget({ usedThisMonth: 10, monthly: 200, perRun: 3, persist: async (t) => void saved.push(t) });
    const results = [await b.reserve(), await b.reserve(), await b.reserve(), await b.reserve()];
    expect(results).toEqual([true, true, true, false]);
    expect(saved).toEqual([11, 12, 13]);
    expect(b.runCount).toBe(3);
  });

  it("stops at the monthly limit", async () => {
    const b = createBudget({ usedThisMonth: 199, monthly: 200, perRun: 40, persist: async () => {} });
    expect(await b.reserve()).toBe(true);
    expect(await b.reserve()).toBe(false);
  });

  it("doesn't count a request whose save failed", async () => {
    const b = createBudget({ usedThisMonth: 0, monthly: 200, perRun: 40, persist: async () => Promise.reject(new Error("db down")) });
    await expect(b.reserve()).rejects.toThrow("db down");
    expect(b.runCount).toBe(0);
  });
});

describe("planSearches", () => {
  it("rotates weekly through every query × city pair", () => {
    const week = 7 * 86_400_000;
    const total = config.cities.length * config.queries.length;
    const seen = new Set<string>();
    for (let w = 0; w * 40 < total; w++) for (const s of planSearches(config, 40, w * week)) seen.add(`${s.query}|${s.city}`);
    expect(seen.size).toBe(total);
    expect(planSearches(config, 40, 0)).toHaveLength(40);
  });
});

describe("Places request", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks only for the fields it uses, one page, no retries", async () => {
    const fn = vi.fn(async () => new Response("", { status: 500 }));
    vi.stubGlobal("fetch", fn);
    await expect(textSearch("k", "manufacturer in Pune", true)).rejects.toThrow("500");
    expect(fn).toHaveBeenCalledTimes(1);
    const init = (fn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toMatchObject({ textQuery: "manufacturer in Pune", pageSize: 20 });
    expect((init.headers as Record<string, string>)["x-goog-fieldmask"]).toBe(fieldMask(true));
  });

  it("leaves out phone numbers and photos, and reviews when not wanted", () => {
    expect(fieldMask(true)).toContain("places.reviews");
    expect(fieldMask(false)).not.toContain("reviews");
    expect(fieldMask(true)).not.toMatch(/phone|photos/i);
  });
});

const place = (over: Partial<Place> = {}): Place => ({
  id: "p1",
  name: "Acme",
  address: "Ahmedabad",
  reviewCount: 40,
  reviews: [],
  website: "https://acme.example",
  ...over,
});
const site = (over: Partial<SiteFacts> = {}): SiteFacts => ({
  reachable: true,
  emailSms: false,
  whatsapp: false,
  crm: false,
  chat: false,
  booking: false,
  adPixel: false,
  tagManager: false,
  ...over,
});

describe("scoring", () => {
  it("reads tools from a home page", () => {
    const facts = readSite(`<script src="https://cdn.shopify.com/x.js"></script><script>fbq('init')</script><a href="https://wa.me/91">`);
    expect(facts).toMatchObject({ store: "shopify", adPixel: true, whatsapp: true, emailSms: false, crm: false });
    expect(readSite(`<script src="//js.hs-scripts.com/1.js"></script><a href="https://calendly.com/x">`)).toMatchObject({ crm: true, booking: true });
  });

  it("ranks a Shopify store with no email tool highly", () => {
    const p = scoreProspect(place(), site({ store: "shopify", whatsapp: true }));
    expect(p.score).toBeGreaterThanOrEqual(3);
    expect(p.pitch).toMatch(/retention/i);
  });

  it("flags review complaints about slow replies", () => {
    const p = scoreProspect(place({ reviews: ["Nobody called back after my enquiry", "Great product"] }), site({ crm: true }));
    expect(p.signals[0]).toMatch(/complain/);
  });

  it("gives a well-equipped site no points", () => {
    expect(scoreProspect(place(), site({ crm: true, chat: true, booking: true })).score).toBe(0);
  });

  it("is less sure about a bare site when tag manager could hide tools", () => {
    expect(scoreProspect(place(), site()).score).toBe(2);
    expect(scoreProspect(place(), site({ tagManager: true })).score).toBe(1);
  });

  it("drops chain branches that share a website", () => {
    const list = [
      { website: "https://www.livspace.com/pune/nibm" },
      { website: "https://livspace.com/pune/kharadi?utm=x" },
      { website: "https://kamsdesigner.com/" },
      { website: undefined },
    ];
    expect(dropChains(list)).toEqual([{ website: "https://kamsdesigner.com/" }, { website: undefined }]);
  });

  it("flags an established business with no website", () => {
    expect(scoreProspect(place({ website: undefined, reviewCount: 120 }), null).signals[0]).toMatch(/No website/);
  });

  it("shows usage and Google attribution in the email", () => {
    const p = { ...scoreProspect(place(), site()), city: "Pune" };
    const { text } = buildProspectsDigest([p], { requests: 4, usedThisMonth: 40, monthly: 200, failures: [] });
    expect(text).toContain("40 of 200 this month");
    expect(text).toContain("© Google Maps");
  });
});
