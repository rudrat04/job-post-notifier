-- Google Maps prospecting (npm run prospects).

-- Places API requests per calendar month, counted before each request is sent,
-- so runs stop well inside Google's free tier.
create table if not exists public.maps_usage (
  month       text primary key,           -- "2026-11" (UTC)
  requests    integer not null default 0,
  updated_at  timestamptz not null default now()
);

alter table public.maps_usage enable row level security;

-- Businesses already emailed. Only the Google place ID is kept: Google allows storing
-- place IDs indefinitely but not names, addresses or reviews.
create table if not exists public.seen_places (
  id          text primary key,           -- Google place ID
  first_seen  timestamptz not null default now()
);

alter table public.seen_places enable row level security;
