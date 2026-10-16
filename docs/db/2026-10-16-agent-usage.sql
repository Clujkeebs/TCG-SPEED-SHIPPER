-- Agent proxy accounting (docs/suite/AGENT-PROXY.md). Additive: new tables and functions only, nothing existing changes.
-- Applied to production on 2026-10-16 through the Supabase connector (apply_migration, name tcgss_agent_usage).
--
-- Money is counted in millicents (1/1000 of a cent) so a call that costs a third of a cent is exact.
-- Every model call first RESERVES its worst case (tcgss_agent_reserve), then SETTLES to the real cost
-- (tcgss_agent_settle). A crash between the two leaves the reservation charged: the safe direction.
-- One advisory lock serialises the two functions, so two requests (or two server copies during a deploy)
-- can never both pass a limit that only has room for one.
-- Only counts and cost are stored. Never the conversation.

create table if not exists public.tcgss_agent_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,                                   -- UTC day
  runs integer not null default 0,                     -- questions asked (a run = a question and everything done to answer it)
  calls integer not null default 0,                    -- model calls
  millicents bigint not null default 0,                -- spend, including calls still in flight (reserved)
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day),
  constraint tcgss_agent_usage_nonneg check (runs >= 0 and calls >= 0 and millicents >= 0 and input_tokens >= 0 and output_tokens >= 0)
);
create index if not exists tcgss_agent_usage_day_idx on public.tcgss_agent_usage (day);

-- Per-user switch: a row here stops the Agent for that user (owner or Builder adds it by hand).
create table if not exists public.tcgss_agent_blocks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now()
);

-- Row level security on with no policies = nobody but the server (service role) can read or write.
alter table public.tcgss_agent_usage enable row level security;
alter table public.tcgss_agent_blocks enable row level security;
revoke all on table public.tcgss_agent_usage, public.tcgss_agent_blocks from anon, authenticated;

-- Can this call go ahead? If yes, count it now (run, call and the worst-case cost) and say so.
-- Refusal codes: blocked, runs, calls, day, month, global (global = everyone together, per day).
create or replace function public.tcgss_agent_reserve(
  p_user uuid, p_day date, p_new_run boolean, p_reserve_mc bigint,
  p_max_runs integer, p_max_calls integer, p_max_day_mc bigint, p_max_month_mc bigint, p_max_global_day_mc bigint)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_runs integer; v_calls integer; v_mc bigint; v_month_mc bigint; v_global_mc bigint;
  v_add_run integer := case when p_new_run then 1 else 0 end;
  v_month_start date := date_trunc('month', p_day)::date;
begin
  if p_user is null or p_day is null or p_reserve_mc is null or p_reserve_mc < 0 then
    return jsonb_build_object('ok', false, 'code', 'bad_request');
  end if;
  perform pg_advisory_xact_lock(hashtext('tcgss_agent'));
  if exists (select 1 from public.tcgss_agent_blocks where user_id = p_user) then
    return jsonb_build_object('ok', false, 'code', 'blocked');
  end if;
  select coalesce(max(runs), 0), coalesce(max(calls), 0), coalesce(max(millicents), 0)
    into v_runs, v_calls, v_mc
    from public.tcgss_agent_usage where user_id = p_user and day = p_day;
  select coalesce(sum(millicents), 0) into v_month_mc
    from public.tcgss_agent_usage
    where user_id = p_user and day >= v_month_start and day < (v_month_start + interval '1 month')::date;
  select coalesce(sum(millicents), 0) into v_global_mc from public.tcgss_agent_usage where day = p_day;

  if p_new_run and v_runs >= p_max_runs then
    return jsonb_build_object('ok', false, 'code', 'runs', 'runs', v_runs);
  end if;
  if v_calls >= p_max_calls then
    return jsonb_build_object('ok', false, 'code', 'calls', 'calls', v_calls);
  end if;
  if v_mc + p_reserve_mc > p_max_day_mc then
    return jsonb_build_object('ok', false, 'code', 'day', 'day_mc', v_mc);
  end if;
  if v_month_mc + p_reserve_mc > p_max_month_mc then
    return jsonb_build_object('ok', false, 'code', 'month', 'month_mc', v_month_mc);
  end if;
  if v_global_mc + p_reserve_mc > p_max_global_day_mc then
    return jsonb_build_object('ok', false, 'code', 'global');
  end if;

  insert into public.tcgss_agent_usage as t (user_id, day, runs, calls, millicents)
    values (p_user, p_day, v_add_run, 1, p_reserve_mc)
    on conflict (user_id, day) do update
      set runs = t.runs + excluded.runs, calls = t.calls + 1, millicents = t.millicents + excluded.millicents, updated_at = now();
  return jsonb_build_object('ok', true,
    'runs', v_runs + v_add_run, 'calls', v_calls + 1,
    'day_mc', v_mc + p_reserve_mc, 'month_mc', v_month_mc + p_reserve_mc);
end $function$;

-- The call finished. Swap the reservation for the real cost and token counts, or, when the model provider
-- refused the call outright (p_failed), take the reservation, the call and a run it started back.
-- Returns today's and this month's totals so the server can say what is left.
create or replace function public.tcgss_agent_settle(
  p_user uuid, p_day date, p_reserved_mc bigint, p_actual_mc bigint, p_in bigint, p_out bigint,
  p_was_new_run boolean, p_failed boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_runs integer; v_calls integer; v_mc bigint; v_month_mc bigint;
  v_month_start date := date_trunc('month', p_day)::date;
begin
  if p_user is null or p_day is null then return jsonb_build_object('ok', false); end if;
  perform pg_advisory_xact_lock(hashtext('tcgss_agent'));
  update public.tcgss_agent_usage set
    millicents = greatest(0, millicents - greatest(0, coalesce(p_reserved_mc, 0)) + case when p_failed then 0 else greatest(0, coalesce(p_actual_mc, 0)) end),
    calls = case when p_failed then greatest(0, calls - 1) else calls end,
    runs = case when p_failed and p_was_new_run then greatest(0, runs - 1) else runs end,
    input_tokens = input_tokens + case when p_failed then 0 else greatest(0, coalesce(p_in, 0)) end,
    output_tokens = output_tokens + case when p_failed then 0 else greatest(0, coalesce(p_out, 0)) end,
    updated_at = now()
    where user_id = p_user and day = p_day;
  select coalesce(max(runs), 0), coalesce(max(calls), 0), coalesce(max(millicents), 0)
    into v_runs, v_calls, v_mc
    from public.tcgss_agent_usage where user_id = p_user and day = p_day;
  select coalesce(sum(millicents), 0) into v_month_mc
    from public.tcgss_agent_usage
    where user_id = p_user and day >= v_month_start and day < (v_month_start + interval '1 month')::date;
  return jsonb_build_object('ok', true, 'runs', v_runs, 'calls', v_calls, 'day_mc', v_mc, 'month_mc', v_month_mc);
end $function$;

-- What is used so far (read only), for the panel's "3 runs left".
create or replace function public.tcgss_agent_status(p_user uuid, p_day date)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare
  v_runs integer; v_calls integer; v_mc bigint; v_month_mc bigint;
  v_month_start date := date_trunc('month', p_day)::date;
begin
  select coalesce(max(runs), 0), coalesce(max(calls), 0), coalesce(max(millicents), 0)
    into v_runs, v_calls, v_mc
    from public.tcgss_agent_usage where user_id = p_user and day = p_day;
  select coalesce(sum(millicents), 0) into v_month_mc
    from public.tcgss_agent_usage
    where user_id = p_user and day >= v_month_start and day < (v_month_start + interval '1 month')::date;
  return jsonb_build_object('runs', v_runs, 'calls', v_calls, 'day_mc', v_mc, 'month_mc', v_month_mc,
    'blocked', exists (select 1 from public.tcgss_agent_blocks where user_id = p_user));
end $function$;

-- Only the server (service role) may call these. Supabase grants new functions to everyone by default.
revoke all on function public.tcgss_agent_reserve(uuid, date, boolean, bigint, integer, integer, bigint, bigint, bigint) from public, anon, authenticated;
revoke all on function public.tcgss_agent_settle(uuid, date, bigint, bigint, bigint, bigint, boolean, boolean) from public, anon, authenticated;
revoke all on function public.tcgss_agent_status(uuid, date) from public, anon, authenticated;
grant execute on function public.tcgss_agent_reserve(uuid, date, boolean, bigint, integer, integer, bigint, bigint, bigint) to service_role;
grant execute on function public.tcgss_agent_settle(uuid, date, bigint, bigint, bigint, bigint, boolean, boolean) to service_role;
grant execute on function public.tcgss_agent_status(uuid, date) to service_role;
