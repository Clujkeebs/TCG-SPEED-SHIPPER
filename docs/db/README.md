# Database files

The database is Supabase (project `lwqnsvlfffugyvwblqaz`, free plan: **no automatic backups**).

- `schema-2026-10-15.sql`: the whole schema (12 tables, 27 functions, indexes, constraints, row level
  security, grants). No data, no keys. Replayed in a scratch Postgres on Oct 15: it builds, the new-user
  trigger works, and the postage ledger functions behave (idempotent top-up, no overdraw).
- `2026-*.sql`: migrations applied after that export, newest last. Add every new migration here the same
  day you apply it, and re-export the schema file after big changes.

## If the project is ever lost
1. New Supabase project, then run `schema-2026-10-15.sql` and any newer migration files.
2. Auth users and rows are not in these files. People sign up again; paying customers keep their Stripe
   subscription and the Stripe webhook re-links plan state by email.
3. Railway variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (the owner pastes keys; agents never read them).
4. Before real postage balances are held (money owed to sellers), upgrade Supabase to Pro (daily backups,
   7 days), then do one restore test. Until then there is nothing to restore from but these files.
