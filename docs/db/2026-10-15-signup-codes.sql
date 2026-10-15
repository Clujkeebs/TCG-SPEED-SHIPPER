-- Sign-up email codes (feature flag SIGNUP_EMAIL_CODE=on). Applied to production
-- on 2026-10-15 through the Supabase connector (apply_migration, name
-- tcgss_signup_codes). Server-only: RLS on, no policies, no grants to
-- anon/authenticated. The server reads and writes it with the service role.
create table if not exists public.tcgss_signup_codes (
  email        text primary key,
  code_hash    text not null,
  expires_at   timestamptz not null,
  attempts     integer not null default 0,
  sends        integer not null default 1,
  window_start timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
alter table public.tcgss_signup_codes enable row level security;
revoke all on table public.tcgss_signup_codes from anon, authenticated;
