# Job Post Notifier

Checks the public job feeds of Greenhouse, Lever, Ashby and Workable boards for roles that match `config/filters.yaml`. It emails a digest of postings it hasn't sent before. GitHub Actions runs it at 09:00 and 18:00 IST, and when nothing new turns up, no email goes out.

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

## Finding companies you haven't listed
- **Workable search** (`config/search.yaml`): each run searches every company hiring through Workable for your role keywords in India. No company list needed.
- **Discovery** (`npm run discover`): reads company names from `config/candidates.txt`, finds which have a Greenhouse, Lever, Ashby or Workable board with a job in your locations, and writes them to `config/discovered.yaml`, which the daily run also checks. It takes about 10 minutes. Add names to `candidates.txt` and rerun it whenever you like.

Greenhouse, Lever and Ashby have no cross-company search, so coverage there is limited to the companies listed in `companies.yaml` and `discovered.yaml`.
