import { createHash } from "node:crypto";
import { sendEmail } from "../email";
import { googleSearch, hasSearchKey } from "../leads/sources/websearch";
import { modeFrom, startRun } from "../runlog";
import { createStore, type SeenRow } from "../store";
import { loadFoundersConfig } from "./config";
import { buildFoundersDigest, type FounderTarget } from "./email";
import { companiesFromNews, companyKey, searchFunding, type NewsItem } from "./funding";
import { exaFounders, exaRoleHolders, searchExaPeople } from "./exa";
import { founderQuery, foundersIn, roleHoldersIn, rolePattern, roleQuery, searchPhrases } from "./linkedin";
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

  // 2. Per company: find its founders, then look for anyone already in the roles. Exa's
  // people search reads LinkedIn work history, so it is used when there is a key; Google
  // (Serper) is the fallback. PDL is a second opinion on the roles, free when it finds no one.
  const roles = rolePattern(config.roles);
  const useExa = Boolean(process.env.EXA_API_KEY);
  const usePdl = Boolean(process.env.PDL_API_KEY);
  if (!useExa && !hasSearchKey()) throw new Error("Set EXA_API_KEY (or SERPER_API_KEY / SERPAPI_KEY) to look up founders");
  const used = { exa: 0, google: 0, pdl: 0 };
  const spend = (kind: keyof typeof used) => used[kind]++;
  const exaPhrases = searchPhrases(config.roles).join(", ");

  const findFounders = async (name: string, context: string) => {
    if (useExa) {
      spend("exa");
      const people = await searchExaPeople(`Founder or co-founder of ${name}. ${context}`, 15);
      const found = { founders: exaFounders(people, name, config.max_founders_per_company), holders: exaRoleHolders(people, name, roles) };
      // Exa misses some profiles; Google often has them ("Building Arborum Labs").
      if (found.founders.length || !hasSearchKey() || used.google >= config.limits.google) return found;
    }
    spend("google");
    const people = await googleSearch(founderQuery(name), undefined, 10);
    return { founders: foundersIn(people, name, config.max_founders_per_company), holders: roleHoldersIn(people, name, roles) };
  };

  const findHolders = async (name: string, context: string): Promise<string[]> => {
    if (useExa) {
      spend("exa");
      const holders = exaRoleHolders(await searchExaPeople(`${exaPhrases} at ${name}. ${context}`, 15), name, roles);
      if (holders.length) return holders;
    } else {
      spend("google");
      const holders = roleHoldersIn(await googleSearch(roleQuery(name, config.roles), undefined, 10), name, roles);
      if (holders.length) return holders;
    }
    if (usePdl && used.pdl < config.limits.pdl) {
      spend("pdl");
      const holder = await pdlRoleHolder(name, config.roles);
      if (holder) return [`${holder}, per PDL`];
    }
    // Exa misses some people, so a gap is confirmed with one Google search when there's a key.
    if (useExa && hasSearchKey() && used.google < config.limits.google) {
      spend("google");
      return roleHoldersIn(await googleSearch(roleQuery(name, config.roles), undefined, 10), name, roles);
    }
    return [];
  };

  const checked: SeenRow[] = [];
  const targets: FounderTarget[] = [];
  let waiting = 0;
  for (const [i, company] of fresh.entries()) {
    // Each company needs up to two searches from the main provider.
    const out = useExa ? used.exa + 2 > config.limits.exa : used.google + 2 > config.limits.google;
    if (out || checked.length >= config.max_companies) {
      waiting = fresh.length - i;
      break;
    }
    const row = (title: string): SeenRow => ({ id: companyId(company.name), company: company.name, title, url: company.url, source: "founders" });
    try {
      const found = await findFounders(company.name, company.headline);
      if (!found.founders.length) {
        console.log(`${company.name}: no founder profile found`);
        checked.push(row("no founder found"));
        continue;
      }
      // The founder search often turns up a Founder's Office hire too, which saves a search.
      const holders = found.holders.length ? found.holders : await findHolders(company.name, company.headline);
      if (holders.length) {
        console.log(`${company.name}: has ${holders.slice(0, 2).join(", ")}`);
        checked.push(row(`has role: ${holders.slice(0, 2).join(", ")}`));
        continue;
      }
      console.log(`${company.name}: GAP — ${found.founders.map((f) => f.name).join(", ")}`);
      targets.push({ company, founders: found.founders });
      checked.push(row(`founders: ${found.founders.map((f) => f.name).join(", ")}`));
    } catch (err) {
      // Not recorded, so the company is tried again next run.
      console.warn(`${company.name}: FAILED — ${errorMessage(err)}`);
      failures.push(`${company.name} (${errorMessage(err)})`);
    }
  }

  const notes: string[] = [];
  if (waiting) notes.push(`${waiting} more companies wait for the next run (per-run limit).`);
  if (failures.length) notes.push(`Couldn't check: ${failures.slice(0, 8).join("; ")}${failures.length > 8 ? ` and ${failures.length - 8} more` : ""}.`);
  console.log(
    `\nSearches: ${used.exa} Exa, ${used.google} Google, ${used.pdl} PDL. ${checked.length} companies checked, ${targets.length} with no one in the roles`,
  );
  run.failures = failures;
  run.counts = { companies: companies.length, new: fresh.length, checked: checked.length, gaps: targets.length, exa: used.exa, google: used.google, pdl: used.pdl };

  const digest = buildFoundersDigest(targets, config.roles, notes);
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
