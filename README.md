# Job Post Notifier

Checks the public job feeds of Greenhouse, Lever, Ashby and Workable boards for roles that match `config/filters.yaml`. It emails a digest of postings it hasn't sent before. It runs as a GitHub Actions workflow started by cron-job.org at 13:00 and 18:00 IST (GitHub's own scheduler runs hours late, so it is not used), and when nothing new turns up, no email goes out.

## Configure
- `config/companies.yaml`: career page URLs. The ATS is detected from the URL, or from the page's HTML for a company's own careers page.
- `config/filters.yaml`: title patterns, title and description exclusions, and locations.

## Setup
1. Run `supabase/migrations/001_seen_jobs.sql` in your Supabase project.
   Also run `supabase/migrations/006_run_logs.sql`: every run of every script (jobs, leads, events, prospects, founders) adds a row to `run_logs` with its status (`ok`, `partial` when some sources failed, `failed` when it crashed), counts and the reasons sources failed. That includes runs that sent no email, so it's where to look when a digest is quiet or missing. Without the table, runs still work and print one warning.
2. Copy `.env.example` to `.env` and fill it in. The keys are under Supabase → Project Settings → API (service role key) and on resend.com.
3. `npm install`
4. `npm run dry-run`: fetches, filters and prints the digest. It sends and saves nothing, and needs no keys.
5. `npm run bootstrap`: marks everything currently matching as seen, so your first email isn't a flood.
6. `npm start`: a normal run that emails new matches, then records them.

## Deploy
Push to GitHub and add the repo secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `EMAIL_TO` and `EMAIL_FROM`. To run it by hand, open Actions → Job digest → Run workflow and pick a mode.

With `onboarding@resend.dev` as the sender, Resend only delivers to the address on your Resend account. Verify a domain to send from your own address.

## Tests
`npm test` runs the filter and ATS-detection unit tests.

## Finding jobs without a company list
`config/search.yaml` holds the role keywords, which are searched across job sites:
- **Workable** covers every company hiring through Workable. It needs no key.
- **JSearch** (`RAPIDAPI_KEY`) is an aggregator on RapidAPI. Add the key to `.env` and to the GitHub secrets; without it the source is skipped with a note in the log. The Basic plan allows 200 requests a month, so each run makes at most 3 and rotates through the JSearch queries. Dry runs skip it.

- **JobSpy** scrapes LinkedIn, Naukri and Indeed through the open-source [JobSpy](https://github.com/speedyapply/JobSpy) CLI, pinned to 1.4.0. Locally, install it with `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`. These sites forbid scraping and may block GitHub's servers; a blocked site is listed under "couldn't check" and the rest of the run carries on.

The same role found on several sites is emailed once, matched on company and title.

Freelance, contract and fractional roles (a title with a word like "fractional", "contract" or "freelance" plus a GTM, RevOps, CRM or automation word, set under `freelance:` in `config/filters.yaml`) are listed in their own section at the top of the email. They skip the location, seniority and experience rules, since that work is usually remote.

For employers' own boards, `npm run discover` reads company names from `config/candidates.txt`, finds which have a Greenhouse, Lever, Ashby or Workable board with a job in your locations, and writes them to `config/discovered.yaml`, which the daily run also checks. It takes about 10 minutes.

## Freelance leads
`npm run leads` finds people and companies asking for a freelance or fractional GTM engineer or automation builder, and emails them separately from the job digest. Everything is set in `config/leads.yaml`.
- **n8n and Make forums**: new posts in the n8n community's Jobs section and Make's Hire a Pro section. No key needed.
- **Reddit**: one search across GTM, sales, e-commerce and automation subreddits. Without a key it uses the public feed, which Reddit often blocks from GitHub's servers; a free Reddit "script" app (`REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`) makes it reliable.
- **Hacker News** posts and comments, through the free Algolia search.
- **LinkedIn and Reddit posts via Google** (Serper, `SERPER_API_KEY`, with SerpApi's `SERPAPI_KEY` as a fallback): 6 searches a run. Skipped without a key.

A post counts only when it explicitly asks for help with a service in the list: in the first person ("we're looking for a HubSpot consultant", "I need someone to…"), as a question to the crowd ("can anyone recommend…"), or as a sentence that opens with the ask ("Looking for a GTM engineer", "n8n expert needed"). Talk about a role ("every founder needs a RevOps expert") isn't an ask. Adverts and promotion, job seekers ("looking for freelance work", "open to opportunities"), surveys, partnership hunts and full-time job posts are dropped. Freelancer.com projects only need to name a service, and in Hacker News "Who is hiring" threads only contract and fractional roles count. `npm run leads:dry-run` prints without sending or saving. The workflow `leads.yml` is meant to be started daily by cron-job.org. Sent leads are remembered in the `seen_leads` table (`supabase/migrations/004_seen_leads.sql`).

## Founders to DM
`npm run founders` emails a separate list of founders at freshly funded Indian startups where nobody on the team shows up on LinkedIn as a GTM Engineer or GTM Lead, in the Founder's Office, as a Founder's Associate, Chief of Staff or Product Marketing Manager. Each entry has the founders' names with their LinkedIn profiles and a LinkedIn search link for the company, ready for a cold DM. Everything is set in `config/founders.yaml`, including the list of role titles and their spellings.
- Company names come from Google News funding stories from the past 7 days (free).
- **Exa** (`EXA_API_KEY`) people search finds each company's founders from their LinkedIn work history, then a second search looks for anyone currently in one of the roles. It costs about $0.007 a search, and the free monthly credit covers well over 1,000.
- **People Data Labs** (`PDL_API_KEY`) gets asked when Exa finds no one in the roles. It's free when PDL finds nobody, and 1 credit when it finds someone. Its data lags LinkedIn by months, so it can only rule a company out. The free plan allows 10 searches a minute, so the run waits between calls.
- Exa misses some people, so Google (Serper) fills in: one search for founders when Exa finds none, and one search for the roles before a company that still looks like a gap is emailed. That comes to about 10 Serper searches a week.
- Without an Exa key, Google (Serper) finds founders and role holders instead, from search-result titles. That is less accurate and uses up the one-off Serper allowance.
- "No one found" is a strong hint, not proof. Glance at the company's People tab before you DM.
- Every company checked is remembered in `seen_founders` (`supabase/migrations/007_seen_founders.sql`), whatever the outcome, so no company is searched twice.

A run checks up to 20 companies, with per-provider caps under `limits`; the rest wait for the next run. Start `founders.yml` weekly from cron-job.org, and add `EXA_API_KEY` and `PDL_API_KEY` to the repo secrets. `npm run founders:dry-run` prints without emailing or saving, but its searches still count.

## Google Maps prospects
`npm run prospects` finds B2B, D2C and SME businesses on Google Maps that look like they need GTM or automation help, and emails a ranked list once a week. Everything is set in `config/prospects.yaml`. Nothing is sent to the businesses: reach out by hand.
- Each run searches "<business type> in <city>" (Places API (New) Text Search, one page of up to 20 per request), rotating weekly through every type × city pair.
- Each business's home page is fetched once (free) to see what it runs: a Shopify or WooCommerce store, email/SMS marketing tools, WhatsApp, a CRM, chat, booking and ad pixels. Up to 5 recent reviews are checked for complaints about slow replies.
- Points: review complaints (2 each, up to 4), a store with no email/SMS tool (3), a plain contact form with no CRM, chat or booking (2, or 1 if a tag manager could be hiding tools), no website despite 50+ reviews (2), ads with no CRM (1), a store with no WhatsApp (1), a dead website (1), 100+ reviews (1). Businesses scoring 3 or more are emailed, best first, with a suggested pitch.
- Chains (several results sharing one website) and businesses with under 20 or over 3,000 reviews are skipped.

**Staying in Google's free tier.** Asking for website, rating and reviews puts each request in the "Text Search Enterprise + Atmosphere" SKU, which has 1,000 free requests a month. Every request is counted in the `maps_usage` table before it is sent, and a run stops at 40 requests or at 200 for the month, whichever comes first. Failed requests are not retried and no second pages are fetched. Only Google place IDs are stored (`seen_places`), as Google's terms allow; names, addresses and reviews are not kept. Tables: `supabase/migrations/005_prospects.sql`.

`npm run prospects:dry-run` prints without emailing, but its requests still count. The workflow `prospects.yml` is meant to be started weekly by cron-job.org.

## Free events
`npm run events` finds free tech, product and marketing events with registration still open and emails them. It sends nothing when there is no new event. Everything is set in `config/events.yaml`.
- **In person** in Mumbai, Pune, Ahmedabad and Bengaluru, from [Luma](https://luma.com): free, not full, no waitlist.
- **Virtual** events from [Meetup](https://www.meetup.com)'s online search, free with RSVP open. Eventbrite is not used because it blocks GitHub's servers.
- Events starting within 30 days whose title or host matches `topics` and not `exclude`. The email puts **Big events** first: a well-known company organizing on Luma (brand list in `config/events.yaml`) or at least 200 people registered. Everything else is under **Other events**. The same event on both sites, or a session repeated on many dates, is sent once.

`npm run events:dry-run` prints without sending or saving; add `-- --all` to include events already emailed. The workflow `events.yml` is started by cron-job.org at 09:00 IST. Sent events are remembered in the `seen_events` table (`supabase/migrations/003_seen_events.sql`).
