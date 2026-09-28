---
name: funnel
description: Pull TCG Speed Shipper's marketing/funnel numbers in one SQL call (visits, CSV loads, signups, paying mix, newsletter subs, partners, by source). Use for the Monday scoreboard, marketing plans, "how are we doing", or judging an ad/outreach test.
---

# Funnel numbers (one `mcp__Supabase__execute_sql` call, project `lwqnsvlfffugyvwblqaz`)

```sql
select
 (select json_object_agg(event, n) from (select event, sum(count) n from tcgss_daily_events where day > current_date - 7 group by event) x) events_7d,
 (select json_object_agg(source, n) from (select source, sum(count) n from tcgss_daily_events where day > current_date - 7 and event='visit' group by source) y) visits_by_source_7d,
 (select json_object_agg(source, n) from (select source, sum(count) n from tcgss_daily_events where day > current_date - 7 and event='signup' group by source) z) signups_by_source_7d,
 (select json_object_agg(coalesce(plan,'null'), n) from (select plan, count(*) n from tcgss_profiles group by plan) p) plans,
 (select count(*) from auth.users) accounts,
 (select count(*) from auth.users where created_at > now() - interval '7 days') accounts_7d,
 (select count(*) from tcgss_newsletter_subscribers where status='subscribed') newsletter,
 (select count(*) from tcgss_affiliates) partners;
```

- **Ad test:** filter the source to `google_ads`.
- **Outreach:** `affiliate` / `referral`.
- **Newsletter clicks:** `email`.

Write the result into the Scoreboard row in `docs/MARKETING-PLAN.md`
(counts only, never emails).

**Break-even:** a paying seller is worth about $36. Keep a channel if it
brings a paying customer for $15 or less.
