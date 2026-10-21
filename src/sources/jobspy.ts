import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import { contentId } from "../dedupe";
import type { Job } from "../types";

const run = promisify(execFile);

interface JobspyRow {
  site?: string;
  title?: string;
  company?: string;
  location?: string;
  date_posted?: string;
  is_remote?: boolean;
  job_url?: string;
  description?: string;
}

/** Finds the JobSpy CLI: $JOBSPY_BIN, then ./.venv, then PATH. Returns null if it isn't installed. */
export async function findJobspy(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const candidates = [env.JOBSPY_BIN, ".venv/bin/jobspy", "jobspy"].filter((c): c is string => Boolean(c));
  for (const bin of candidates) {
    try {
      if (bin.includes("/")) await access(bin);
      await run(bin, ["--version"], { timeout: 20_000 });
      return bin;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export function parseJobspyLines(stdout: string): Job[] {
  const jobs: Job[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let r: JobspyRow;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (!r.title || !r.job_url) continue;
    const company = r.company?.trim() || "Unknown company";
    const location = r.location?.trim() ?? "";
    const remote = Boolean(r.is_remote) || /\bremote\b/i.test(location);
    jobs.push({
      id: contentId(company, r.title),
      externalId: r.job_url,
      company,
      title: r.title.trim(),
      location: remote && !/\bremote\b/i.test(location) ? `Remote${location ? ` (${location})` : ""}` : location,
      remote,
      url: r.job_url,
      source: "jobspy",
      postedAt: r.date_posted,
      description: r.description,
    });
  }
  return jobs;
}

export async function searchJobspy(
  bin: string,
  opts: { sites: string[]; query: string; where: string; remote: boolean; hoursOld: number; results: number },
): Promise<Job[]> {
  // Arguments are passed as an array (no shell), so config values can't inject commands.
  const args = [
    opts.query,
    "--site",
    opts.sites.join(","),
    "--location",
    opts.where,
    "--country-indeed",
    "india",
    "-n",
    String(opts.results),
    "--quiet",
  ];
  if (opts.hoursOld > 0) args.push("--hours-old", String(opts.hoursOld));
  if (opts.remote) args.push("--remote");
  try {
    const { stdout } = await run(bin, args, { timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });
    return parseJobspyLines(stdout);
  } catch (err) {
    // Exit code 1 means every board failed (usually blocked); anything on stdout is still usable.
    const stdout = (err as { stdout?: string }).stdout;
    if (stdout?.trim()) return parseJobspyLines(stdout);
    const stderr = (err as { stderr?: string }).stderr?.trim().split("\n").pop();
    throw new Error(stderr || (err as Error).message);
  }
}
