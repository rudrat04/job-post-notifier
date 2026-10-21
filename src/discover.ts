import { readFile, writeFile } from "node:fs/promises";
import pLimit from "p-limit";
import { stringify } from "yaml";
import { loadFilters } from "./config";
import { buildMatcher } from "./filter";
import { fetchJobs } from "./sources";
import type { Ats, ResolvedCompany } from "./types";

const ATS_LIST: Ats[] = ["greenhouse", "lever", "ashby", "workable"];

const BOARD_URL: Record<Ats, (slug: string) => string> = {
  greenhouse: (s) => `https://boards.greenhouse.io/${s}`,
  lever: (s) => `https://jobs.lever.co/${s}`,
  ashby: (s) => `https://jobs.ashbyhq.com/${s}`,
  workable: (s) => `https://apply.workable.com/${s}`,
};

/** "Hugging Face" → ["huggingface", "hugging-face", "huggingfacehq"] */
export function slugVariants(name: string): string[] {
  const words = name.toLowerCase().replace(/[^a-z0-9\s.-]/g, "").trim().split(/[\s.]+/).filter(Boolean);
  if (!words.length) return [];
  const joined = words.join("");
  return [...new Set([joined, words.join("-"), `${joined}hq`])];
}

async function main() {
  const filters = await loadFilters();
  // Location-only matcher: any title, any age. A board is worth watching if it hires where we can work.
  const inLocation = buildMatcher({
    ...filters,
    titles: [".+"],
    title_combos: [],
    exclude_title: [],
    exclude_description: [],
    include_keywords: [],
    max_age_days: 0,
  });
  const fullMatch = buildMatcher({ ...filters, max_age_days: 0 });

  const names = (await readFile("config/candidates.txt", "utf8"))
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  const unique = [...new Map(names.map((n) => [n.toLowerCase(), n])).values()];
  console.log(`Probing ${unique.length} companies across ${ATS_LIST.length} job-board providers…`);

  const limit = pLimit(10);
  const found: { name: string; ats: Ats; slug: string; jobs: number; local: number; relevant: number }[] = [];

  await Promise.all(
    unique.flatMap((name) =>
      slugVariants(name).flatMap((slug) =>
        ATS_LIST.map((ats) =>
          limit(async () => {
            const company: ResolvedCompany = { name, url: "", ats, slug };
            try {
              const jobs = await fetchJobs(company);
              if (!jobs.length) return;
              const local = jobs.filter((j) => inLocation(j)).length;
              if (!local) return;
              const relevant = jobs.filter((j) => fullMatch(j)).length;
              found.push({ name, ats, slug, jobs: jobs.length, local, relevant });
            } catch {
              // 404 etc: this company isn't on this provider under this slug.
            }
          }),
        ),
      ),
    ),
  );

  // One entry per company: prefer the board with the most jobs where we can work.
  const best = new Map<string, (typeof found)[number]>();
  for (const f of found) {
    const cur = best.get(f.name);
    if (!cur || f.local > cur.local) best.set(f.name, f);
  }
  const boards = [...best.values()].sort((a, b) => a.name.localeCompare(b.name));

  const header =
    "# Written by `npm run discover` from config/candidates.txt. Safe to delete or regenerate.\n" +
    "# Only boards with at least one job in an accepted location are kept.\n";
  const body = stringify({
    companies: boards.map((b) => ({
      url: BOARD_URL[b.ats](b.slug),
      name: b.name,
      ats: b.ats,
      slug: b.slug,
    })),
  });
  await writeFile("config/discovered.yaml", header + body);

  for (const b of boards) {
    console.log(
      `${b.name.padEnd(24)} ${b.ats.padEnd(10)} ${b.slug.padEnd(22)} ${String(b.jobs).padStart(4)} jobs, ${b.local} local, ${b.relevant} relevant`,
    );
  }
  console.log(`\n${boards.length} of ${unique.length} companies have a usable board → config/discovered.yaml`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
