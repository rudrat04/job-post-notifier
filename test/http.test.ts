import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http";
import { mergeDuplicates } from "../src/dedupe";
import type { MatchedJob } from "../src/types";

describe("HttpError", () => {
  it("leaves the query string (and any API key in it) out of the message", () => {
    const err = new HttpError(500, "https://serpapi.com/search.json?q=x&api_key=SECRET123");
    expect(err.message).toBe("HTTP 500 from https://serpapi.com/search.json");
    expect(err.message).not.toContain("SECRET123");
  });
});

describe("mergeDuplicates location flag", () => {
  const base: MatchedJob = {
    id: "a",
    externalId: "1",
    company: "Acme",
    title: "GTM Engineer",
    location: "",
    remote: false,
    url: "https://jsearch.example/1",
    source: "jsearch",
    locationMissing: true,
  };
  it("clears locationMissing when another copy had a location", () => {
    const [merged] = mergeDuplicates([base, { ...base, location: "Bengaluru", locationMissing: false }]);
    expect(merged.location).toBe("Bengaluru");
    expect(merged.locationMissing).toBe(false);
  });
});
