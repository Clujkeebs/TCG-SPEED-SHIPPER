-- Applied to production on 2026-10-15 through the Supabase connector
-- (apply_migration, name tcgss_revoke_client_table_grants).
-- Defense in depth. The browser never reads these tables directly (it calls the
-- security-definer functions such as tcgss_get_status) and the server uses the
-- service role. Row level security already denies everything else; this removes
-- the broad default grants too, so a future policy mistake cannot expose a table.
revoke all on table
  public.tcgss_affiliate_earnings, public.tcgss_affiliates, public.tcgss_daily_events,
  public.tcgss_event_log, public.tcgss_label_usage, public.tcgss_newsletter_subscribers,
  public.tcgss_postage_labels, public.tcgss_postage_ledger, public.tcgss_profiles,
  public.tcgss_promo_ip_redemptions, public.tcgss_referral_credits, public.tcgss_signup_codes
from anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
