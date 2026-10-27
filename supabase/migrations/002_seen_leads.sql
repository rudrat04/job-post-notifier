-- Freelance leads that have already been emailed (or marked seen by --bootstrap).
create table if not exists public.seen_leads (
  id          text primary key,           -- sha1(source:url)
  company     text not null,              -- origin of the lead: subreddit, outlet, ...
  title       text not null,
  url         text not null,
  source      text not null,
  first_seen  timestamptz not null default now()
);

create index if not exists seen_leads_first_seen_idx on public.seen_leads (first_seen desc);

alter table public.seen_leads enable row level security;
