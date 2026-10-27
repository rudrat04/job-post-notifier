# Job Post Notifier

Checks the public job feeds of Greenhouse, Lever, Ashby and Workable boards for roles that match `config/filters.yaml`. It emails a digest of postings it hasn't sent before. GitHub Actions runs it at 13:00 and 18:00 IST, and when nothing new turns up, no email goes out.

## Configure
- `config/companies.yaml`: career page URLs. The ATS is detected from the URL, or from the page's HTML for a company's own careers page.
- `config/filters.yaml`: title patterns, title and description exclusions, and locations.

## Setup
1. Run `supabase/migrations/001_seen_jobs.sql` in your Supabase project.
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
- **Adzuna** (`ADZUNA_APP_ID`, `ADZUNA_APP_KEY`), **Jooble** (`JOOBLE_API_KEY`) and **JSearch** (`RAPIDAPI_KEY`) are aggregators. Add the free keys to `.env` and to the GitHub secrets. A source without its key is skipped with a note in the log.

- **JobSpy** scrapes LinkedIn, Naukri and Indeed through the open-source [JobSpy](https://github.com/speedyapply/JobSpy) CLI, pinned to 1.4.0. Locally, install it with `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`. These sites forbid scraping and may block GitHub's servers; a blocked site is listed under "couldn't check" and the rest of the run carries on.

The same role found on several sites is emailed once, matched on company and title.

For employers' own boards, `npm run discover` reads company names from `config/candidates.txt`, finds which have a Greenhouse, Lever, Ashby or Workable board with a job in your locations, and writes them to `config/discovered.yaml`, which the daily run also checks. It takes about 10 minutes.

## Freelance leads
`npm run leads` finds people who may need your services (websites, GTM engineering, GTM strategy) and emails them separately from the job digest. Everything is set in `config/leads.yaml`.
- **Reddit** (search feed, no key), **Hacker News** (Algolia search) and **Freelancer.com** (public API): a post counts when it asks for help close to one of your services, and people advertising themselves are dropped. Freelancer projects are limited by budget and bid count.
- **Funding news** (Google News): newly funded Indian startups, one per company.
- Companies hiring GTM or RevOps roles in the job digest are leads too.

`npm run leads:dry-run` prints without sending or saving. The workflow `leads.yml` runs at 13:15 and 18:15 IST. Leads are remembered in the `seen_leads` table (`supabase/migrations/002_seen_leads.sql`). Reddit rate-limits quickly, so if it blocks a run it is listed under "couldn't check".
