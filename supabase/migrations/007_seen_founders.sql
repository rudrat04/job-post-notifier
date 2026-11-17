-- Companies already checked by the founders script (npm run founders), whatever the outcome,
-- so the same company never costs Google searches twice.
create table if not exists public.seen_founders (
  id          text primary key,           -- sha1("founders:" + normalized company name)
  company     text not null,
  title       text not null,              -- outcome: "founders: …", "has role: …" or "no founder found"
  url         text not null,              -- the funding story
  source      text not null,
  first_seen  timestamptz not null default now()
);

create index if not exists seen_founders_first_seen_idx on public.seen_founders (first_seen desc);

alter table public.seen_founders enable row level security;
