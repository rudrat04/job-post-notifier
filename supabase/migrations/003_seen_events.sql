-- Events that have already been emailed (or marked seen by --bootstrap).
create table if not exists public.seen_events (
  id          text primary key,           -- sha1(url)
  company     text not null,              -- city, or "Online"
  title       text not null,
  url         text not null,
  source      text not null,
  first_seen  timestamptz not null default now()
);

create index if not exists seen_events_first_seen_idx on public.seen_events (first_seen desc);

alter table public.seen_events enable row level security;

-- The freelance leads feature was removed.
drop table if exists public.seen_leads;
