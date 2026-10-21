import { describe, expect, it } from "vitest";
import { contentId, mergeDuplicates } from "../src/dedupe";
import type { Job } from "../src/types";

const job = (over: Partial<Job>): Job => ({
  id: contentId(over.company ?? "Acme", over.title ?? "RevOps Manager"),
  externalId: "1",
  company: "Acme",
  title: "RevOps Manager",
  location: "Mumbai",
  remote: false,
  url: "https://example.com/a",
  source: "lever",
  ...over,
});

describe("contentId", () => {
  it("ignores case, punctuation and company suffixes", () => {
    expect(contentId("Acme Pvt. Ltd.", "RevOps Manager")).toBe(contentId("ACME", "revops  manager"));
    expect(contentId("Meesho Technologies Private Limited", "GTM Lead")).toBe(contentId("Meesho", "GTM Lead"));
  });

  it("separates different roles and companies", () => {
    expect(contentId("Acme", "RevOps Manager")).not.toBe(contentId("Acme", "RevOps Analyst"));
    expect(contentId("Acme", "RevOps Manager")).not.toBe(contentId("Beta", "RevOps Manager"));
  });
});

describe("mergeDuplicates", () => {
  it("joins locations and prefers the employer's own link over an aggregator's", () => {
    const merged = mergeDuplicates([
      job({ source: "adzuna", url: "https://adzuna/x", location: "Mumbai" }),
      job({ source: "lever", url: "https://lever/x", location: "Bengaluru" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].location).toBe("Mumbai / Bengaluru");
    expect(merged[0].url).toBe("https://lever/x");
    expect(merged[0].source).toBe("lever");
  });

  it("does not repeat a location", () => {
    const merged = mergeDuplicates([job({ location: "Mumbai" }), job({ location: "Mumbai" })]);
    expect(merged[0].location).toBe("Mumbai");
  });
});
