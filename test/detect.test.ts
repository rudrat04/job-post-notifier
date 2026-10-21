import { describe, expect, it } from "vitest";
import { detectFromText } from "../src/detect";

describe("detectFromText", () => {
  it.each([
    ["https://boards.greenhouse.io/acme", "greenhouse", "acme"],
    ["https://job-boards.greenhouse.io/acme/jobs/123", "greenhouse", "acme"],
    ["https://job-boards.eu.greenhouse.io/groww", "greenhouse", "groww"],
    ['<script src="https://boards.greenhouse.io/embed/job_board/js?for=acme">', "greenhouse", "acme"],
    ["https://jobs.lever.co/cred", "lever", "cred"],
    ["https://jobs.lever.co/cred/aa98a938-af3a", "lever", "cred"],
    ["https://jobs.ashbyhq.com/sarvam", "ashby", "sarvam"],
    ["https://apply.workable.com/huggingface/", "workable", "huggingface"],
    ["https://apply.workable.com/api/v1/widget/accounts/acme", "workable", "acme"],
  ])("%s → %s/%s", (url, ats, slug) => {
    expect(detectFromText(url)).toEqual({ ats, slug });
  });

  it("returns null for an unknown page", () => {
    expect(detectFromText("https://careers.example.com")).toBeNull();
  });
});
