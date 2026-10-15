-- TCG Speed Shipper: full database schema (no data), exported 2026-10-15.
--
-- WHY THIS FILE EXISTS: the Supabase project is on the free plan, which has no
-- automatic backups, and until today the schema lived only inside that project
-- (37 applied migrations, one SQL file in this folder). If the project were
-- lost, nothing here could rebuild it. This file can.
--
-- HOW IT WAS MADE: read-only catalog queries against the live project
-- (pg_get_functiondef, pg_get_constraintdef, pg_indexes, pg_policies and so on).
-- It contains structure only. No rows, no keys, no passwords.
--
-- HOW TO USE IT (a new, empty Supabase project):
--   1. Run this whole file in the SQL editor (or apply it as one migration).
--   2. Auth users are NOT in this file (Supabase keeps them in the auth schema).
--      After a total loss, people sign up again; paying customers keep their
--      Stripe subscription, and the Stripe webhook re-links plan state by email.
--   3. Point Railway at the new project: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
--   4. Re-apply any migration newer than the date above (docs/db/*.sql, newest last).
--
-- KEEP IT CURRENT: whenever you apply a migration, add its SQL to docs/db/ the
-- same day, and re-export this file after big changes.
--
-- Includes migration tcgss_revoke_client_table_grants (Oct 15): the browser and
-- the anon role have NO table privileges; only security-definer functions and the
-- server's service role touch these tables.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

-- ---------------------------------------------------------------- TABLES
CREATE TABLE public.tcgss_affiliate_earnings (
  id bigint GENERATED ALWAYS AS IDENTITY,
  affiliate_id uuid NOT NULL,
  referred_user_id uuid NOT NULL,
  stripe_invoice_id text NOT NULL,
  amount_cents integer NOT NULL,
  commission_cents integer NOT NULL,
  currency text DEFAULT 'usd'::text NOT NULL,
  period_month date NOT NULL,
  payout_status text DEFAULT 'owed'::text NOT NULL,
  paid_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.tcgss_affiliates (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  affiliate_code text NOT NULL,
  dashboard_token text NOT NULL,
  commission_rate numeric(4,3) DEFAULT 0.400 NOT NULL,
  status text DEFAULT 'invited'::text NOT NULL,
  agreement_start date,
  agreement_end date,
  free_until timestamp with time zone,
  user_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.tcgss_daily_events (
  day date DEFAULT ((now() AT TIME ZONE 'utc'::text))::date NOT NULL,
  event text NOT NULL,
  source text DEFAULT 'direct'::text NOT NULL,
  count integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.tcgss_event_log (
  id bigint GENERATED ALWAYS AS IDENTITY,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  level text DEFAULT 'error'::text NOT NULL,
  source text NOT NULL,
  message text NOT NULL,
  context jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE public.tcgss_label_usage (
  user_id uuid NOT NULL,
  period_month date NOT NULL,
  labels_count integer DEFAULT 0 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.tcgss_newsletter_subscribers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  email text NOT NULL,
  source text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  status text DEFAULT 'subscribed'::text NOT NULL,
  unsub_token uuid DEFAULT gen_random_uuid() NOT NULL,
  ip_hash text,
  unsubscribed_at timestamp with time zone,
  last_sent_at timestamp with time zone
);

CREATE TABLE public.tcgss_postage_labels (
  id bigint GENERATED ALWAYS AS IDENTITY,
  user_id uuid NOT NULL,
  shipment_id text NOT NULL,
  tracking_number text,
  service text NOT NULL,
  amount numeric(10,2),
  mode text NOT NULL,
  order_ref text,
  status text DEFAULT 'purchased'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  refunded_at timestamp with time zone,
  fee numeric(10,2),
  price numeric(10,2),
  label_pdf text
);

CREATE TABLE public.tcgss_postage_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY,
  user_id uuid NOT NULL,
  cents integer NOT NULL,
  kind text NOT NULL,
  ref text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.tcgss_profiles (
  id uuid NOT NULL,
  email text,
  plan text DEFAULT 'free'::text NOT NULL,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  subscription_status text,
  current_period_end timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  is_lifetime_free boolean DEFAULT false NOT NULL,
  referral_code text,
  referred_by uuid,
  referred_at timestamp with time zone,
  affiliate_id uuid,
  affiliate_attributed_at timestamp with time zone,
  free_until timestamp with time zone
);

CREATE TABLE public.tcgss_promo_ip_redemptions (
  id bigint GENERATED ALWAYS AS IDENTITY,
  promotion_code_id text NOT NULL,
  ip_hash text NOT NULL,
  user_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.tcgss_referral_credits (
  id bigint GENERATED ALWAYS AS IDENTITY,
  referrer_id uuid NOT NULL,
  referred_user_id uuid NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  stripe_balance_transaction_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  claimed_at timestamp with time zone,
  applied_at timestamp with time zone,
  applied_method text
);

CREATE TABLE public.tcgss_signup_codes (
  email text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  sends integer DEFAULT 1 NOT NULL,
  window_start timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ---------------------------------------------------------------- CONSTRAINTS
ALTER TABLE ONLY public.tcgss_affiliate_earnings ADD CONSTRAINT tcgss_affiliate_earnings_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tcgss_affiliates ADD CONSTRAINT tcgss_affiliates_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tcgss_daily_events ADD CONSTRAINT tcgss_daily_events_pkey PRIMARY KEY (day, event, source);
ALTER TABLE ONLY public.tcgss_event_log ADD CONSTRAINT tcgss_event_log_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tcgss_label_usage ADD CONSTRAINT tcgss_label_usage_pkey PRIMARY KEY (user_id, period_month);
ALTER TABLE ONLY public.tcgss_newsletter_subscribers ADD CONSTRAINT tcgss_newsletter_subscribers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tcgss_postage_labels ADD CONSTRAINT tcgss_postage_labels_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tcgss_postage_ledger ADD CONSTRAINT tcgss_postage_ledger_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tcgss_profiles ADD CONSTRAINT tcgss_profiles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tcgss_promo_ip_redemptions ADD CONSTRAINT tcgss_promo_ip_redemptions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tcgss_referral_credits ADD CONSTRAINT tcgss_referral_credits_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tcgss_signup_codes ADD CONSTRAINT tcgss_signup_codes_pkey PRIMARY KEY (email);
ALTER TABLE ONLY public.tcgss_affiliate_earnings ADD CONSTRAINT tcgss_affiliate_earnings_stripe_invoice_id_key UNIQUE (stripe_invoice_id);
ALTER TABLE ONLY public.tcgss_newsletter_subscribers ADD CONSTRAINT tcgss_newsletter_subscribers_email_key UNIQUE (email);
ALTER TABLE ONLY public.tcgss_newsletter_subscribers ADD CONSTRAINT tcgss_newsletter_subscribers_unsub_token_key UNIQUE (unsub_token);
ALTER TABLE ONLY public.tcgss_postage_labels ADD CONSTRAINT tcgss_postage_labels_shipment_id_key UNIQUE (shipment_id);
ALTER TABLE ONLY public.tcgss_profiles ADD CONSTRAINT tcgss_profiles_stripe_customer_id_key UNIQUE (stripe_customer_id);
ALTER TABLE ONLY public.tcgss_promo_ip_redemptions ADD CONSTRAINT tcgss_promo_ip_redemptions_promotion_code_id_ip_hash_key UNIQUE (promotion_code_id, ip_hash);
ALTER TABLE ONLY public.tcgss_referral_credits ADD CONSTRAINT tcgss_referral_credits_referred_user_id_key UNIQUE (referred_user_id);
ALTER TABLE ONLY public.tcgss_affiliate_earnings ADD CONSTRAINT tcgss_affiliate_earnings_payout_status_check CHECK ((payout_status = ANY (ARRAY['owed'::text, 'paid'::text])));
ALTER TABLE ONLY public.tcgss_affiliates ADD CONSTRAINT tcgss_affiliates_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'active'::text, 'ended'::text])));
ALTER TABLE ONLY public.tcgss_event_log ADD CONSTRAINT tcgss_event_log_level_check CHECK ((level = ANY (ARRAY['error'::text, 'warn'::text, 'info'::text, 'admin'::text])));
ALTER TABLE ONLY public.tcgss_newsletter_subscribers ADD CONSTRAINT tcgss_newsletter_subscribers_email_check CHECK ((email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text));
ALTER TABLE ONLY public.tcgss_newsletter_subscribers ADD CONSTRAINT tcgss_newsletter_subscribers_status_check CHECK ((status = ANY (ARRAY['subscribed'::text, 'unsubscribed'::text])));
ALTER TABLE ONLY public.tcgss_postage_labels ADD CONSTRAINT tcgss_postage_labels_mode_check CHECK ((mode = ANY (ARRAY['sandbox'::text, 'production'::text])));
ALTER TABLE ONLY public.tcgss_postage_labels ADD CONSTRAINT tcgss_postage_labels_service_check CHECK ((service = ANY (ARRAY['letter'::text, 'ground'::text])));
ALTER TABLE ONLY public.tcgss_postage_labels ADD CONSTRAINT tcgss_postage_labels_status_check CHECK ((status = ANY (ARRAY['purchased'::text, 'refund_requested'::text, 'refunded'::text, 'refund_denied'::text])));
ALTER TABLE ONLY public.tcgss_postage_ledger ADD CONSTRAINT tcgss_postage_ledger_kind_check CHECK ((kind = ANY (ARRAY['topup'::text, 'label'::text, 'refund'::text, 'adjust'::text])));
ALTER TABLE ONLY public.tcgss_profiles ADD CONSTRAINT tcgss_no_self_referral CHECK (((referred_by IS NULL) OR (referred_by <> id)));
ALTER TABLE ONLY public.tcgss_profiles ADD CONSTRAINT tcgss_profiles_plan_check CHECK ((plan = ANY (ARRAY['free'::text, 'base'::text, 'premium'::text])));
ALTER TABLE ONLY public.tcgss_referral_credits ADD CONSTRAINT tcgss_referral_credits_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'applied'::text])));
ALTER TABLE ONLY public.tcgss_affiliate_earnings ADD CONSTRAINT tcgss_affiliate_earnings_affiliate_id_fkey FOREIGN KEY (affiliate_id) REFERENCES public.tcgss_affiliates(id);
ALTER TABLE ONLY public.tcgss_affiliate_earnings ADD CONSTRAINT tcgss_affiliate_earnings_referred_user_id_fkey FOREIGN KEY (referred_user_id) REFERENCES public.tcgss_profiles(id);
ALTER TABLE ONLY public.tcgss_affiliates ADD CONSTRAINT tcgss_affiliates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.tcgss_profiles(id);
ALTER TABLE ONLY public.tcgss_label_usage ADD CONSTRAINT tcgss_label_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.tcgss_profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tcgss_postage_labels ADD CONSTRAINT tcgss_postage_labels_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tcgss_postage_ledger ADD CONSTRAINT tcgss_postage_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tcgss_profiles ADD CONSTRAINT tcgss_profiles_affiliate_id_fkey FOREIGN KEY (affiliate_id) REFERENCES public.tcgss_affiliates(id);
ALTER TABLE ONLY public.tcgss_profiles ADD CONSTRAINT tcgss_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tcgss_profiles ADD CONSTRAINT tcgss_profiles_referred_by_fkey FOREIGN KEY (referred_by) REFERENCES public.tcgss_profiles(id);
ALTER TABLE ONLY public.tcgss_promo_ip_redemptions ADD CONSTRAINT tcgss_promo_ip_redemptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.tcgss_profiles(id);
ALTER TABLE ONLY public.tcgss_referral_credits ADD CONSTRAINT tcgss_referral_credits_referred_user_id_fkey FOREIGN KEY (referred_user_id) REFERENCES public.tcgss_profiles(id);
ALTER TABLE ONLY public.tcgss_referral_credits ADD CONSTRAINT tcgss_referral_credits_referrer_id_fkey FOREIGN KEY (referrer_id) REFERENCES public.tcgss_profiles(id);

-- ---------------------------------------------------------------- INDEXES
CREATE INDEX tcgss_affiliate_earnings_affiliate_idx ON public.tcgss_affiliate_earnings USING btree (affiliate_id, payout_status);
CREATE INDEX tcgss_affiliate_earnings_referred_user_id_idx ON public.tcgss_affiliate_earnings USING btree (referred_user_id);
CREATE UNIQUE INDEX tcgss_affiliates_code_idx ON public.tcgss_affiliates USING btree (affiliate_code);
CREATE UNIQUE INDEX tcgss_affiliates_email_idx ON public.tcgss_affiliates USING btree (lower(email));
CREATE UNIQUE INDEX tcgss_affiliates_token_idx ON public.tcgss_affiliates USING btree (dashboard_token);
CREATE INDEX tcgss_affiliates_user_id_idx ON public.tcgss_affiliates USING btree (user_id);
CREATE INDEX tcgss_event_log_created_at_idx ON public.tcgss_event_log USING btree (created_at DESC);
CREATE INDEX tcgss_postage_labels_user_idx ON public.tcgss_postage_labels USING btree (user_id, created_at DESC);
CREATE UNIQUE INDEX tcgss_postage_ledger_refund_once ON public.tcgss_postage_ledger USING btree (ref) WHERE (kind = 'refund'::text);
CREATE UNIQUE INDEX tcgss_postage_ledger_topup_once ON public.tcgss_postage_ledger USING btree (ref) WHERE (kind = 'topup'::text);
CREATE INDEX tcgss_postage_ledger_user_idx ON public.tcgss_postage_ledger USING btree (user_id, created_at DESC);
CREATE INDEX tcgss_profiles_affiliate_id_idx ON public.tcgss_profiles USING btree (affiliate_id);
CREATE UNIQUE INDEX tcgss_profiles_referral_code_idx ON public.tcgss_profiles USING btree (referral_code);
CREATE INDEX tcgss_profiles_referred_by_idx ON public.tcgss_profiles USING btree (referred_by);
CREATE INDEX tcgss_profiles_stripe_customer_idx ON public.tcgss_profiles USING btree (stripe_customer_id);
CREATE INDEX tcgss_promo_ip_redemptions_user_id_idx ON public.tcgss_promo_ip_redemptions USING btree (user_id);
CREATE INDEX tcgss_referral_credits_referrer_idx ON public.tcgss_referral_credits USING btree (referrer_id, status);

-- ---------------------------------------------------------------- FUNCTIONS
CREATE OR REPLACE FUNCTION public.tcgss_activate_affiliate(p_affiliate_id uuid)
 RETURNS tcgss_affiliates
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.tcgss_affiliates;
begin
  update public.tcgss_affiliates
    set status = 'active',
        agreement_start = current_date,
        agreement_end = current_date + interval '1 year',
        updated_at = now()
    where id = p_affiliate_id
    returning * into v_row;

  if v_row.id is null then
    raise exception 'affiliate not found';
  end if;

  if v_row.user_id is not null then
    update public.tcgss_profiles
      set free_until = now() + interval '1 year'
      where id = v_row.user_id;
  end if;

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tcgss_admin_prepare_user_delete(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if exists (select 1 from public.tcgss_profiles where id = p_user_id and is_lifetime_free) then
    return jsonb_build_object('ok', false, 'reason', 'owner_account');
  end if;
  if exists (select 1 from public.tcgss_affiliate_earnings where referred_user_id = p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'has_affiliate_earnings');
  end if;
  update public.tcgss_profiles set referred_by = null where referred_by = p_user_id;
  delete from public.tcgss_referral_credits where referrer_id = p_user_id or referred_user_id = p_user_id;
  -- Keep the IP hash so a deleted-and-recreated account can't re-claim a free code.
  update public.tcgss_promo_ip_redemptions set user_id = null where user_id = p_user_id;
  update public.tcgss_affiliates set user_id = null where user_id = p_user_id;
  return jsonb_build_object('ok', true);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tcgss_apply_affiliate_code(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_own_email text;
  v_affiliate record;
  v_already boolean;
  v_created_at timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select affiliate_id is not null, p.created_at into v_already, v_created_at
  from public.tcgss_profiles p where p.id = v_uid;

  if v_already then
    return jsonb_build_object('applied', false, 'reason', 'already_attributed');
  end if;
  if v_created_at is null or v_created_at < now() - interval '2 hours' then
    return jsonb_build_object('applied', false, 'reason', 'too_late');
  end if;

  select * into v_affiliate from public.tcgss_affiliates
  where affiliate_code = upper(trim(p_code)) and status <> 'ended';

  if v_affiliate.id is null then
    return jsonb_build_object('applied', false, 'reason', 'invalid_code');
  end if;

  select email into v_own_email from auth.users where id = v_uid;
  if v_affiliate.user_id = v_uid or lower(coalesce(v_own_email, '')) = lower(v_affiliate.email) then
    return jsonb_build_object('applied', false, 'reason', 'self_referral');
  end if;

  update public.tcgss_profiles
    set affiliate_id = v_affiliate.id, affiliate_attributed_at = now()
    where id = v_uid and affiliate_id is null;

  if v_affiliate.user_id is null then
    update public.tcgss_affiliates a
      set user_id = v_uid, updated_at = now()
      where a.id = v_affiliate.id
        and lower(v_own_email) = lower(a.email);
  end if;

  return jsonb_build_object('applied', true);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tcgss_apply_referral_code(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_referrer uuid;
  v_already_referred boolean;
  v_created_at timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select referred_by is not null, p.created_at into v_already_referred, v_created_at
  from public.tcgss_profiles p where p.id = v_uid;

  if v_already_referred then
    return jsonb_build_object('applied', false, 'reason', 'already_referred');
  end if;
  if v_created_at is null or v_created_at < now() - interval '2 hours' then
    return jsonb_build_object('applied', false, 'reason', 'too_late');
  end if;

  select id into v_referrer from public.tcgss_profiles
  where referral_code = upper(trim(p_code));

  if v_referrer is null then
    return jsonb_build_object('applied', false, 'reason', 'invalid_code');
  end if;
  if v_referrer = v_uid then
    return jsonb_build_object('applied', false, 'reason', 'self_referral');
  end if;

  update public.tcgss_profiles
    set referred_by = v_referrer, referred_at = now()
    where id = v_uid and referred_by is null;

  return jsonb_build_object('applied', true);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tcgss_bump_event(p_event text, p_source text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.tcgss_daily_events (day, event, source, count)
  values ((now() at time zone 'utc')::date, p_event, coalesce(nullif(p_source, ''), 'direct'), 1)
  on conflict (day, event, source) do update set count = public.tcgss_daily_events.count + 1;
$function$
;

CREATE OR REPLACE FUNCTION public.tcgss_claim_pending_referral_credits(p_referrer_id uuid)
 RETURNS SETOF tcgss_referral_credits
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.tcgss_referral_credits
    set status = 'processing', claimed_at = now()
    where referrer_id = p_referrer_id and status = 'pending'
    returning *
$function$
;

CREATE OR REPLACE FUNCTION public.tcgss_consume_label_credits(p_count integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_plan text;
  v_lifetime boolean;
  v_free_until timestamptz;
  v_limit integer;
  v_period date := date_trunc('month', now())::date;
  v_current integer;
  v_new integer;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_count is null or p_count < 1 then
    raise exception 'invalid count';
  end if;

  select plan, is_lifetime_free, free_until into v_plan, v_lifetime, v_free_until
  from public.tcgss_profiles where id = v_uid;

  if v_plan is null then
    select email into v_email from auth.users where id = v_uid;
    v_lifetime := public.tcgss_is_owner_email(v_email);
    v_plan := case when v_lifetime then 'premium' else 'free' end;
    insert into public.tcgss_profiles (id, email, plan, is_lifetime_free)
    values (v_uid, v_email, v_plan, v_lifetime)
    on conflict (id) do nothing;
  end if;

  if v_lifetime or (v_free_until is not null and v_free_until > now()) then
    v_plan := 'premium';
  end if;

  v_limit := case v_plan when 'free' then 10 when 'base' then 500 else null end;

  insert into public.tcgss_label_usage (user_id, period_month, labels_count)
  values (v_uid, v_period, 0)
  on conflict (user_id, period_month) do nothing;

  select labels_count into v_current
  from public.tcgss_label_usage
  where user_id = v_uid and period_month = v_period
  for update;

  if v_limit is not null and v_current + p_count > v_limit then
    return jsonb_build_object(
      'allowed', false, 'plan', v_plan, 'limit', v_limit,
      'used', v_current, 'remaining', greatest(v_limit - v_current, 0),
      'is_lifetime_free', coalesce(v_lifetime, false)
    );
  end if;

  v_new := v_current + p_count;
  update public.tcgss_label_usage
    set labels_count = v_new, updated_at = now()
    where user_id = v_uid and period_month = v_period;

  return jsonb_build_object(
    'allowed', true, 'plan', v_plan, 'limit', v_limit,
    'used', v_new,
    'remaining', case when v_limit is null then null else greatest(v_limit - v_new, 0) end,
    'is_lifetime_free', coalesce(v_lifetime, false)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tcgss_create_affiliate(p_name text, p_email text, p_commission_rate numeric DEFAULT 0.400)
 RETURNS tcgss_affiliates
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_code text;
  v_row public.tcgss_affiliates;
  v_attempt int := 0;
begin
  loop
    v_code := public.tcgss_generate_affiliate_code();
    begin
      insert into public.tcgss_affiliates (name, email, affiliate_code, dashboard_token, commission_rate)
      values (p_name, lower(trim(p_email)), v_code, public.tcgss_generate_dashboard_token(), p_commission_rate)
      returning * into v_row;
      exit;
    exception when unique_violation then
      v_attempt := v_attempt + 1;
      if v_attempt >= 5 then raise; end if;
    end;
  end loop;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tcgss_find_auth_user_id(p_email text)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ select id from auth.users where lower(email) = lower(p_email) limit 1; $function$
;

CREATE OR REPLACE FUNCTION public.tcgss_generate_affiliate_code()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  raw bytea := extensions.gen_random_bytes(6);
  code text := '';
  i int;
begin
  for i in 0..5 loop
    code := code || substr(alphabet, (get_byte(raw, i) % length(alphabet)) + 1, 1);
  end loop;
  return code;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tcgss_generate_dashboard_token()
 RETURNS text
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  SELECT encode(extensions.gen_random_bytes(32), 'hex')
$function$
;

CREATE OR REPLACE FUNCTION public.tcgss_generate_referral_code()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  raw bytea := extensions.gen_random_bytes(8);
  code text := '';
  i int;
begin
  for i in 0..7 loop
    code := code || substr(alphabet, (get_byte(raw, i) % length(alphabet)) + 1, 1);
  end loop;
  return code;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tcgss_get_affiliate_dashboard(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_affiliate public.tcgss_affiliates;
  v_referred_count integer;
  v_paying_count integer;
  v_owed_cents integer;
  v_paid_cents integer;
  v_lifetime_cents integer;
  v_free_until timestamptz;
begin
  select * into v_affiliate from public.tcgss_affiliates where dashboard_token = p_token;
  if v_affiliate.id is null then
    return null;
  end if;

  select count(*) into v_referred_count from public.tcgss_profiles where affiliate_id = v_affiliate.id;
  select count(distinct referred_user_id) into v_paying_count from public.tcgss_affiliate_earnings where affiliate_id = v_affiliate.id;
  select coalesce(sum(commission_cents) filter (where payout_status = 'owed'), 0) into v_owed_cents from public.tcgss_affiliate_earnings where affiliate_id = v_affiliate.id;
  select coalesce(sum(commission_cents) filter (where payout_status = 'paid'), 0) into v_paid_cents from public.tcgss_affiliate_earnings where affiliate_id = v_affiliate.id;
  v_lifetime_cents := v_owed_cents + v_paid_cents;

  -- The affiliate's own free year lives on their linked profile row
  -- (tcgss_profiles.free_until, set by tcgss_activate_affiliate), not on
  -- tcgss_affiliates.free_until, which nothing ever populates.
  if v_affiliate.user_id is not null then
    select free_until into v_free_until from public.tcgss_profiles where id = v_affiliate.user_id;
    if v_free_until is not null and v_free_until <= now() then
      v_free_until := null;
    end if;
  end if;

  return jsonb_build_object(
    'name', v_affiliate.name,
    'affiliate_code', v_affiliate.affiliate_code,
    'status', v_affiliate.status,
    'commission_rate', v_affiliate.commission_rate,
    'agreement_start', v_affiliate.agreement_start,
    'agreement_end', v_affiliate.agreement_end,
    'free_until', v_free_until,
    'referred_signups', v_referred_count,
    'referred_paying_customers', v_paying_count,
    'owed_cents', v_owed_cents,
    'paid_cents', v_paid_cents,
    'lifetime_cents', v_lifetime_cents
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tcgss_get_referral_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_code text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select referral_code into v_code from public.tcgss_profiles where id = v_uid;

  return jsonb_build_object(
    'code', v_code,
    'applied_credits', (select count(*) from public.tcgss_referral_credits where referrer_id = v_uid and status = 'applied'),
    'pending_credits', (select count(*) from public.tcgss_referral_credits where referrer_id = v_uid and status in ('pending', 'processing')),
    'stripe_credits_applied', (select count(*) from public.tcgss_referral_credits where referrer_id = v_uid and status = 'applied' and applied_method = 'stripe_credit'),
    'free_months_granted', (select count(*) from public.tcgss_referral_credits where referrer_id = v_uid and status = 'applied' and applied_method = 'free_month_grant')
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tcgss_get_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_plan text;
  v_lifetime boolean;
  v_free_until timestamptz;
  v_limit integer;
  v_period date := date_trunc('month', now())::date;
  v_used integer;
  v_free_active boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select plan, is_lifetime_free, free_until into v_plan, v_lifetime, v_free_until
  from public.tcgss_profiles where id = v_uid;

  if v_plan is null then
    select email into v_email from auth.users where id = v_uid;
    v_lifetime := public.tcgss_is_owner_email(v_email);
    v_plan := case when v_lifetime then 'premium' else 'free' end;
    insert into public.tcgss_profiles (id, email, plan, is_lifetime_free)
    values (v_uid, v_email, v_plan, v_lifetime)
    on conflict (id) do nothing;
  end if;

  v_free_active := (v_free_until is not null and v_free_until > now());

  if v_lifetime or v_free_active then
    v_plan := 'premium';
  end if;

  v_limit := case v_plan when 'free' then 10 when 'base' then 500 else null end;

  select labels_count into v_used
  from public.tcgss_label_usage
  where user_id = v_uid and period_month = v_period;

  return jsonb_build_object(
    'plan', v_plan, 'limit', v_limit, 'used', coalesce(v_used, 0),
    'is_lifetime_free', coalesce(v_lifetime, false),
    'free_until', case when v_free_active then v_free_until else null end
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tcgss_grant_referral_free_month(p_credit_id bigint, p_referrer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_matched integer;
begin
  -- Flip the claimed credit first; only a row that was genuinely claimed
  -- (status = 'processing') for this referrer earns the free month. A replay,
  -- a made-up credit id, or someone else's credit changes nothing.
  update public.tcgss_referral_credits
    set status = 'applied', applied_at = now(), applied_method = 'free_month_grant'
    where id = p_credit_id and referrer_id = p_referrer_id and status = 'processing';
  get diagnostics v_matched = row_count;

  if v_matched = 0 then
    return;
  end if;

  update public.tcgss_profiles
    set free_until = greatest(coalesce(free_until, now()), now()) + interval '30 days',
        updated_at = now()
    where id = p_referrer_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tcgss_handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_code text;
  v_attempt int := 0;
begin
  loop
    v_code := public.tcgss_generate_referral_code();
    begin
      if public.tcgss_is_owner_email(new.email) then
        insert into public.tcgss_profiles (id, email, plan, is_lifetime_free, referral_code)
        values (new.id, new.email, 'premium', true, v_code)
        on conflict (id) do update set plan = 'premium', is_lifetime_free = true;
      else
        insert into public.tcgss_profiles (id, email, referral_code)
        values (new.id, new.email, v_code)
        on conflict (id) do nothing;
      end if;
      exit;
    exception when unique_violation then
      -- Collision on the 8-character code (astronomically unlikely) — try a
      -- fresh one rather than failing the signup.
      v_attempt := v_attempt + 1;
      if v_attempt >= 5 then raise; end if;
    end;
  end loop;
  return new;
end;
$function$
;

-- The owner's address (also OWNER_EMAIL in Railway and in server.js) is the lifetime-free account.
CREATE OR REPLACE FUNCTION public.tcgss_is_owner_email(p_email text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$ select lower(coalesce(p_email, '')) = 'clujkeebs@aol.com' $function$
;

CREATE OR REPLACE FUNCTION public.tcgss_list_affiliates_summary()
 RETURNS TABLE(id uuid, name text, email text, affiliate_code text, status text, commission_rate numeric, agreement_start date, agreement_end date, referred_signups bigint, referred_paying_customers bigint, owed_cents bigint, paid_cents bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    a.id, a.name, a.email, a.affiliate_code, a.status, a.commission_rate,
    a.agreement_start, a.agreement_end,
    (select count(*) from public.tcgss_profiles p where p.affiliate_id = a.id) as referred_signups,
    (select count(distinct e.referred_user_id) from public.tcgss_affiliate_earnings e where e.affiliate_id = a.id) as referred_paying_customers,
    coalesce((select sum(e.commission_cents) from public.tcgss_affiliate_earnings e where e.affiliate_id = a.id and e.payout_status = 'owed'), 0) as owed_cents,
    coalesce((select sum(e.commission_cents) from public.tcgss_affiliate_earnings e where e.affiliate_id = a.id and e.payout_status = 'paid'), 0) as paid_cents
  from public.tcgss_affiliates a
  order by a.created_at desc
$function$
;

CREATE OR REPLACE FUNCTION public.tcgss_mark_affiliate_paid(p_affiliate_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  update public.tcgss_affiliate_earnings
    set payout_status = 'paid', paid_at = now()
    where affiliate_id = p_affiliate_id and payout_status = 'owed';
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tcgss_mark_referral_credit_applied(p_credit_id bigint, p_balance_transaction_id text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.tcgss_referral_credits
    set status = 'applied', applied_at = now(), stripe_balance_transaction_id = p_balance_transaction_id,
        applied_method = 'stripe_credit'
    where id = p_credit_id and status = 'processing'
$function$
;

CREATE OR REPLACE FUNCTION public.tcgss_postage_balance(p_user uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(sum(cents), 0)::int from tcgss_postage_ledger where user_id = p_user;
$function$
;

CREATE OR REPLACE FUNCTION public.tcgss_postage_credit(p_user uuid, p_cents integer, p_kind text, p_ref text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_cents is null or p_cents <= 0 or p_kind not in ('topup','refund','adjust') then
    return jsonb_build_object('ok', false, 'error', 'bad credit');
  end if;
  insert into tcgss_postage_ledger (user_id, cents, kind, ref) values (p_user, p_cents, p_kind, p_ref);
  return jsonb_build_object('ok', true, 'balance', tcgss_postage_balance(p_user));
exception when unique_violation then
  return jsonb_build_object('ok', true, 'duplicate', true, 'balance', tcgss_postage_balance(p_user));
end $function$
;

CREATE OR REPLACE FUNCTION public.tcgss_postage_debit(p_user uuid, p_cents integer, p_ref text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare bal integer;
begin
  if p_cents is null or p_cents <= 0 then return jsonb_build_object('ok', false, 'error', 'bad amount'); end if;
  perform pg_advisory_xact_lock(hashtext('tcgss_postage:' || p_user::text));
  select coalesce(sum(cents), 0) into bal from tcgss_postage_ledger where user_id = p_user;
  if bal < p_cents then return jsonb_build_object('ok', false, 'balance', bal); end if;
  insert into tcgss_postage_ledger (user_id, cents, kind, ref) values (p_user, -p_cents, 'label', p_ref);
  return jsonb_build_object('ok', true, 'balance', bal - p_cents);
end $function$
;

CREATE OR REPLACE FUNCTION public.tcgss_record_affiliate_earning(p_referred_user_id uuid, p_stripe_invoice_id text, p_amount_cents integer, p_currency text, p_period_month date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_affiliate_id uuid;
  v_rate numeric;
begin
  select p.affiliate_id, a.commission_rate into v_affiliate_id, v_rate
  from public.tcgss_profiles p
  join public.tcgss_affiliates a on a.id = p.affiliate_id
  where p.id = p_referred_user_id;

  if v_affiliate_id is null then
    return null;
  end if;

  insert into public.tcgss_affiliate_earnings
    (affiliate_id, referred_user_id, stripe_invoice_id, amount_cents, commission_cents, currency, period_month)
  values
    (v_affiliate_id, p_referred_user_id, p_stripe_invoice_id, p_amount_cents,
     round(p_amount_cents * v_rate)::integer, coalesce(p_currency, 'usd'), p_period_month)
  on conflict (stripe_invoice_id) do nothing;

  return v_affiliate_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tcgss_record_referral_conversion(p_referred_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_referrer uuid;
  v_inserted boolean;
begin
  select referred_by into v_referrer
  from public.tcgss_profiles where id = p_referred_user_id;

  if v_referrer is null then
    return null;
  end if;

  insert into public.tcgss_referral_credits (referrer_id, referred_user_id)
  values (v_referrer, p_referred_user_id)
  on conflict (referred_user_id) do nothing;

  get diagnostics v_inserted = row_count;
  -- Only return the referrer id when a NEW reward was actually created. A
  -- resubscription (row already exists) returns null so the caller doesn't
  -- try to apply anything for a reward that isn't real.
  if v_inserted then
    return v_referrer;
  end if;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tcgss_release_referral_credit(p_credit_id bigint)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.tcgss_referral_credits
    set status = 'pending', claimed_at = null
    where id = p_credit_id and status = 'processing'
$function$
;

-- ---------------------------------------------------------------- TRIGGERS
CREATE TRIGGER tcgss_on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.tcgss_handle_new_user();

-- ---------------------------------------------------------------- ROW LEVEL SECURITY
ALTER TABLE public.tcgss_affiliate_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcgss_affiliates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcgss_daily_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcgss_event_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcgss_label_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcgss_newsletter_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcgss_postage_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcgss_postage_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcgss_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcgss_promo_ip_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcgss_referral_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcgss_signup_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tcgss select own usage" ON public.tcgss_label_usage AS PERMISSIVE FOR SELECT TO public USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "tcgss newsletter public insert" ON public.tcgss_newsletter_subscribers AS PERMISSIVE FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "tcgss select own profile" ON public.tcgss_profiles AS PERMISSIVE FOR SELECT TO public USING ((( SELECT auth.uid() AS uid) = id));

-- ---------------------------------------------------------------- GRANTS
-- Functions: nothing is executable by PUBLIC or anon. Signed-in users may call
-- exactly the functions below (the browser uses them; each checks auth.uid()).
REVOKE ALL ON FUNCTION public.tcgss_activate_affiliate(p_affiliate_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tcgss_admin_prepare_user_delete(p_user_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tcgss_apply_affiliate_code(p_code text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tcgss_apply_affiliate_code(p_code text) TO authenticated;
REVOKE ALL ON FUNCTION public.tcgss_apply_referral_code(p_code text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tcgss_apply_referral_code(p_code text) TO authenticated;
REVOKE ALL ON FUNCTION public.tcgss_bump_event(p_event text, p_source text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tcgss_claim_pending_referral_credits(p_referrer_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tcgss_consume_label_credits(p_count integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tcgss_consume_label_credits(p_count integer) TO authenticated;
REVOKE ALL ON FUNCTION public.tcgss_create_affiliate(p_name text, p_email text, p_commission_rate numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tcgss_find_auth_user_id(p_email text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tcgss_generate_affiliate_code() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tcgss_generate_dashboard_token() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tcgss_generate_referral_code() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tcgss_get_affiliate_dashboard(p_token text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tcgss_get_referral_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tcgss_get_referral_stats() TO authenticated;
REVOKE ALL ON FUNCTION public.tcgss_get_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tcgss_get_status() TO authenticated;
REVOKE ALL ON FUNCTION public.tcgss_grant_referral_free_month(p_credit_id bigint, p_referrer_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tcgss_handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tcgss_is_owner_email(p_email text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tcgss_is_owner_email(p_email text) TO authenticated;
REVOKE ALL ON FUNCTION public.tcgss_list_affiliates_summary() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tcgss_mark_affiliate_paid(p_affiliate_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tcgss_mark_referral_credit_applied(p_credit_id bigint, p_balance_transaction_id text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tcgss_postage_balance(p_user uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tcgss_postage_credit(p_user uuid, p_cents integer, p_kind text, p_ref text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tcgss_postage_debit(p_user uuid, p_cents integer, p_ref text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tcgss_record_affiliate_earning(p_referred_user_id uuid, p_stripe_invoice_id text, p_amount_cents integer, p_currency text, p_period_month date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tcgss_record_referral_conversion(p_referred_user_id uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tcgss_release_referral_credit(p_credit_id bigint) FROM PUBLIC, anon, authenticated;

-- Tables: anon and authenticated get nothing (migration tcgss_revoke_client_table_grants),
-- and new tables do not auto-grant to them either.
REVOKE ALL ON TABLE
  public.tcgss_affiliate_earnings, public.tcgss_affiliates, public.tcgss_daily_events,
  public.tcgss_event_log, public.tcgss_label_usage, public.tcgss_newsletter_subscribers,
  public.tcgss_postage_labels, public.tcgss_postage_ledger, public.tcgss_profiles,
  public.tcgss_promo_ip_redemptions, public.tcgss_referral_credits, public.tcgss_signup_codes
  FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
