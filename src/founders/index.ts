import { createHash } from "node:crypto";
import { sendEmail } from "../email";
import { googleSearch, hasSearchKey } from "../leads/sources/websearch";
import { modeFrom, startRun } from "../runlog";
import { createStore, type SeenRow } from "../store";
import { allTitles, loadFoundersConfig } from "./config";
import { buildFoundersDigest, type FounderTarget } from "./email";
import { companiesFromNews, companyKey, searchFunding, type NewsItem } from "./funding";
import { exaFounders, exaHeadcount, exaRoleHolders, searchExaCompanies, searchExaPeople } from "./exa";
import { founderQuery, foundersIn, interleave, roleHoldersIn, rolePattern, roleQuery, searchPhrases } from "./linkedin";
import { pdlRoleHolder } from "./pdl";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const testEmail = args.has("--test-email");
const run = startRun("founders", modeFrom(args));

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
const companyId = (name: string) => createHash("sha1").update(`founders:${companyKey(name)}`).digest("hex");

async function main() {
  const config = await loadFoundersConfig();
  const store = createStore("seen_founders");
  if (!store && !dryRun) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");

  // 1. Company names from funding news (free).
  const failures: string[] = [];
  const keywords = new RegExp(`(?:${config.news.keywords.join("|")})`, "i");
  const exclude = config.news.exclude.length
    ? new RegExp(`(?<![\\w])(?:${config.news.exclude.join("|")})(?![\\w])`, "i")
    : null;
  const news: NewsItem[] = [];
  for (const q of config.news.queries) {
    try {
      const items = (await searchFunding(q, config.news.days)).filter((i) => keywords.test(i.title) && !exclude?.test(i.title));
      console.log(`News "${q}": ${items.length} funding stories`);
      news.push(...items);
    } catch (err) {
      console.warn(`News "${q}": FAILED — ${errorMessage(err)}`);
      failures.push(`News "${q}" (${errorMessage(err)})`);
    }
  }
  if (failures.length === config.news.queries.length) throw new Error("Every news search failed");

  const companies = companiesFromNews(news);
  const seen = store ? await store.seenIds(companies.map((c) => companyId(c.name))) : new Set<string>();
  const fresh = companies.filter((c) => !seen.has(companyId(c.name)));
  console.log(`\n${companies.length} companies in the news, ${fresh.length} not checked before`);

  // 2. Per company: find its founders, then fill in which role groups have someone. Exa's
  // people search reads LinkedIn work history, so it is used when there is a key; Google
  // (Serper) is the fallback and the double-check. PDL is free when it finds no one.
  const groups = Object.entries(config.role_groups).map(([label, titles]) => ({ label, titles, pattern: rolePattern(titles) }));
  const roles = rolePattern(allTitles(config));
  const useExa = Boolean(process.env.EXA_API_KEY);
  const usePdl = Boolean(process.env.PDL_API_KEY);
  if (!useExa && !hasSearchKey()) throw new Error("Set EXA_API_KEY (or SERPER_API_KEY / SERPAPI_KEY) to look up founders");
  const used = { exa: 0, google: 0, pdl: 0 };
  const spend = (kind: keyof typeof used) => used[kind]++;
  const googleLeft = () => hasSearchKey() && used.google < config.limits.google;

  const findFounders = async (name: string, context: string) => {
    if (useExa) {
      spend("exa");
      const people = await searchExaPeople(`Founder or co-founder of ${name}. ${context}`, 15);
      const found = { founders: exaFounders(people, name, config.max_founders_per_company), holders: exaRoleHolders(people, name, roles) };
      // Exa misses some profiles; Google often has them ("Building Arborum Labs").
      if (found.founders.length || !googleLeft()) return found;
    }
    spend("google");
    const people = await googleSearch(founderQuery(name), undefined, 10);
    return { founders: foundersIn(people, name, config.max_founders_per_company), holders: roleHoldersIn(people, name, roles) };
  };

  /** Who fills each group, as far as the searches can tell. Empty groups are the pitch. */
  const fillGroups = async (name: string, context: string, initial: string[]) => {
    const filled = new Map<string, string[]>();
    const add = (holders: string[]) => {
      for (const h of holders)
        for (const g of groups) if (g.pattern.test(h)) filled.set(g.label, [...(filled.get(g.label) ?? []), h]);
    };
    const empty = () => groups.filter((g) => !filled.has(g.label));
    add(initial);
    if (!empty().length) return filled;

    // Interleaved, so a Google search cut short still covers every empty group's main titles.
    const titles = () => interleave(empty().map((g) => g.titles));
    if (useExa) {
      spend("exa");
      add(exaRoleHolders(await searchExaPeople(`${searchPhrases(titles()).join(", ")} at ${name}. ${context}`, 15), name, roles));
    } else {
      spend("google");
      add(roleHoldersIn(await googleSearch(roleQuery(name, titles()), undefined, 10), name, roles));
    }
    for (const g of empty()) {
      if (!usePdl || used.pdl >= config.limits.pdl) break;
      spend("pdl");
      const holder = await pdlRoleHolder(name, g.titles);
      if (holder) filled.set(g.label, [`${holder}, per PDL`]);
    }
    // Exa misses some people, so empty groups get one Google double-check when there's a key.
    if (useExa && empty().length && googleLeft()) {
      spend("google");
      add(roleHoldersIn(await googleSearch(roleQuery(name, titles()), undefined, 10), name, roles));
    }
    return filled;
  };

  const checked: SeenRow[] = [];
  const targets: FounderTarget[] = [];
  let waiting = 0;
  for (const [i, company] of fresh.entries()) {
    // Each company needs up to three searches from the main provider.
    const out = useExa ? used.exa + 3 > config.limits.exa : used.google + 2 > config.limits.google;
    if (out || checked.length >= config.max_companies) {
      waiting = fresh.length - i;
      break;
    }
    const row = (title: string): SeenRow => ({ id: companyId(company.name), company: company.name, title, url: company.url, source: "founders" });
    try {
      // Headcount first, so a big company costs one search and nothing more.
      let size: number | null = null;
      if (useExa) {
        spend("exa");
        size = exaHeadcount(await searchExaCompanies(`${company.name}. ${company.headline}`), company.name);
        if (size !== null && size > config.max_employees) {
          console.log(`${company.name}: ${size} people, over ${config.max_employees}`);
          checked.push(row(`too big: ${size} people`));
          continue;
        }
      }
      const found = await findFounders(company.name, company.headline);
      if (!found.founders.length) {
        console.log(`${company.name}: no founder profile found`);
        checked.push(row("no founder found"));
        continue;
      }
      const filled = await fillGroups(company.name, company.headline, found.holders);
      const missing = groups.filter((g) => !filled.has(g.label)).map((g) => g.label);
      const has = [...filled].map(([label, people]) => `${label}: ${people[0]}`);
      if (!missing.length) {
        console.log(`${company.name}: has every role — ${has.join("; ")}`);
        checked.push(row(`has every role: ${has.join("; ")}`.slice(0, 500)));
        continue;
      }
      console.log(`${company.name} (${size ?? "size unknown"}): MISSING ${missing.join(", ")} — ${found.founders.map((f) => f.name).join(", ")}${has.length ? ` (has ${has.join("; ")})` : ""}`);
      targets.push({ company, founders: found.founders, missing, has, size });
      checked.push(row(`missing ${missing.join(", ")}; founders: ${found.founders.map((f) => f.name).join(", ")}`.slice(0, 500)));
    } catch (err) {
      // Not recorded, so the company is tried again next run.
      console.warn(`${company.name}: FAILED — ${errorMessage(err)}`);
      failures.push(`${company.name} (${errorMessage(err)})`);
    }
  }
  // The emptiest teams first: missing every role is the strongest pitch.
  targets.sort((a, b) => b.missing.length - a.missing.length);

  const notes: string[] = [];
  if (waiting) notes.push(`${waiting} more companies wait for the next run (per-run limit).`);
  if (failures.length) notes.push(`Couldn't check: ${failures.slice(0, 8).join("; ")}${failures.length > 8 ? ` and ${failures.length - 8} more` : ""}.`);
  console.log(
    `\nSearches: ${used.exa} Exa, ${used.google} Google, ${used.pdl} PDL. ${checked.length} companies checked, ${targets.length} missing a role`,
  );
  run.failures = failures;
  run.counts = { companies: companies.length, new: fresh.length, checked: checked.length, gaps: targets.length, exa: used.exa, google: used.google, pdl: used.pdl };

  const digest = buildFoundersDigest(targets, groups.map((g) => g.label), notes, config.max_employees);
  if (dryRun) {
    console.log(`\n--- dry run (nothing sent or saved) ---\n${targets.length ? digest.text : "No new founders."}`);
    return;
  }
  if (testEmail) {
    await sendEmail({ ...digest, subject: `[TEST] ${digest.subject}` });
    console.log(`Test email sent with ${targets.length} companies; nothing was saved.`);
    return;
  }
  if (targets.length) {
    await sendEmail(digest); // send first, then record, so a failed send is retried next run
    run.counts.emailed = targets.length;
    console.log(`Emailed ${targets.length} companies.`);
  } else {
    console.log("No new founders; no email sent.");
  }
  await store!.markSeen(checked);
}

main()
  .then(() => run.finish())
  .catch(async (err) => {
    console.error(errorMessage(err));
    await run.finish(err);
    process.exit(1);
  });
