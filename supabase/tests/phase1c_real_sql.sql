-- Run only against an isolated Supabase/PostgreSQL project after migrations
-- 0001 -> 0002 -> 0003 -> 0004 -> 0005 on isolated staging; production may
-- already have unrelated 0001/0002 objects. The entire fixture rolls back.
\set ON_ERROR_STOP on
begin;

do $phase1c$
declare
  table_name text;
  function_name text;
  function_oid oid;
  function_definer boolean;
  function_config text[];
  function_source text;
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  owner_c uuid := gen_random_uuid();
  run_a uuid;
  run_a_next uuid;
  run_b uuid;
  run_c uuid;
  job_c uuid;
  attempt_c uuid := gen_random_uuid();
  token_b uuid := gen_random_uuid();
  token_c uuid := gen_random_uuid();
  publish_c uuid := gen_random_uuid();
  counted_day date := (clock_timestamp() at time zone 'Asia/Taipei')::date;
  prompt_hash text := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('phase1c', 'UTF8')), 'hex');
  claim_result jsonb;
  run_state text;
begin
  foreach table_name in array array['automation_runs', 'generation_jobs', 'generation_attempts', 'automation_control'] loop
    if not exists (
      select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = table_name and c.relkind = 'r' and c.relrowsecurity
    ) then raise exception 'RLS_OR_TABLE_MISSING: %', table_name; end if;
    if not exists (
      select 1 from pg_catalog.pg_policies
      where schemaname = 'public' and tablename = table_name and cmd = 'SELECT'
    ) then raise exception 'OWNER_SELECT_POLICY_MISSING: %', table_name; end if;
    if not exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = ('public.' || table_name)::regclass and contype = 'p'
    ) or not exists (
      select 1 from pg_catalog.pg_constraint
      where conrelid = ('public.' || table_name)::regclass and contype = 'c'
    ) then raise exception 'PRIMARY_KEY_OR_CHECK_MISSING: %', table_name; end if;
    if pg_catalog.has_table_privilege('anon', 'public.' || table_name, 'SELECT') or
       pg_catalog.has_table_privilege('authenticated', 'public.' || table_name, 'INSERT') or
       pg_catalog.has_table_privilege('authenticated', 'public.' || table_name, 'UPDATE') or
       pg_catalog.has_table_privilege('authenticated', 'public.' || table_name, 'DELETE') then
      raise exception 'TABLE_GRANT_TOO_BROAD: %', table_name;
    end if;
  end loop;

  select pg_catalog.pg_get_functiondef(
    'public.automation_request_command(uuid,uuid,bigint,text,uuid)'::regprocedure)
    into function_source;
  if pg_catalog.strpos(function_source, 'v_today date :=') > 0 or
     pg_catalog.strpos(function_source, 'v_today := (clock_timestamp() at time zone ''Asia/Taipei'')::date;')
       <= pg_catalog.strpos(function_source, 'where owner_user_id = p_owner for update;') then
    raise exception 'COMMAND_TAIPEI_DAY_RESOLVED_BEFORE_OWNER_LOCK';
  end if;
  select pg_catalog.pg_get_functiondef(
    'public.automation_claim_job(uuid,uuid,bigint,uuid,text,text,text,text,text,text)'::regprocedure)
    into function_source;
  if pg_catalog.strpos(function_source, 'v_today date :=') > 0 or
     pg_catalog.strpos(function_source, 'v_today := (clock_timestamp() at time zone ''Asia/Taipei'')::date;')
       <= pg_catalog.strpos(function_source, 'where run_id = p_run and owner_user_id = p_owner for update;') then
    raise exception 'CLAIM_TAIPEI_DAY_RESOLVED_BEFORE_RUN_LOCK';
  end if;

  if not pg_catalog.has_column_privilege('authenticated', 'public.automation_control', 'command_seq', 'SELECT') or
     pg_catalog.has_column_privilege('authenticated', 'public.automation_control', 'lease_token', 'SELECT') or
     pg_catalog.has_column_privilege('authenticated', 'public.automation_control', 'lease_generation', 'SELECT') then
    raise exception 'CONTROL_COLUMN_GRANT_INVALID';
  end if;

  foreach function_name in array array[
    'automation_bootstrap_owner', 'automation_request_command', 'automation_daily_success_count',
    'automation_acquire_lease', 'automation_renew_lease', 'automation_release_lease',
    'automation_finish_run', 'automation_claim_job', 'automation_advance_attempt',
    'automation_fail_safe_attempt', 'automation_new_attempt', 'automation_complete_publication',
    'automation_hard_stop', 'automation_recovery_snapshot'
  ] loop
    select p.oid, p.prosecdef, p.proconfig into function_oid, function_definer, function_config
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = function_name;
    if not found or not function_definer or not exists (
      select 1 from pg_catalog.unnest(function_config) as setting(value)
      where value like 'search_path=%'
    ) then raise exception 'UNSAFE_OR_MISSING_RPC: %', function_name; end if;
    if pg_catalog.has_function_privilege('anon', function_oid, 'EXECUTE') or
       pg_catalog.has_function_privilege('authenticated', function_oid, 'EXECUTE') <> (function_name in
         ('automation_request_command', 'automation_daily_success_count')) or
       pg_catalog.has_function_privilege('service_role', function_oid, 'EXECUTE') <>
         (function_name <> 'automation_request_command') then
      raise exception 'RPC_EXECUTE_GRANT_INVALID: %', function_name;
    end if;
  end loop;

  foreach function_name in array array[
    'assert_worker', 'require_lease', 'daily_count'
  ] loop
    select p.oid into function_oid from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'automation_private' and p.proname = function_name;
    if not found or pg_catalog.has_function_privilege('anon', function_oid, 'EXECUTE') or
       pg_catalog.has_function_privilege('authenticated', function_oid, 'EXECUTE') or
       pg_catalog.has_function_privilege('service_role', function_oid, 'EXECUTE') then
      raise exception 'PRIVATE_HELPER_EXPOSED: %', function_name;
    end if;
  end loop;

  if pg_catalog.has_function_privilege('anon',
       'public.automation_request_command(uuid,uuid,bigint,text,uuid)', 'EXECUTE') or
     pg_catalog.has_function_privilege('authenticated',
       'public.automation_claim_job(uuid,uuid,bigint,uuid,text,text,text,text,text,text)', 'EXECUTE') or
     not pg_catalog.has_function_privilege('authenticated',
       'public.automation_request_command(uuid,uuid,bigint,text,uuid)', 'EXECUTE') or
     not pg_catalog.has_function_privilege('service_role',
       'public.automation_claim_job(uuid,uuid,bigint,uuid,text,text,text,text,text,text)', 'EXECUTE') then
    raise exception 'RPC_EXECUTE_GRANT_INVALID';
  end if;

  if not exists (select 1 from pg_catalog.pg_indexes where schemaname = 'public'
      and indexname = 'generation_jobs_one_unresolved_per_owner') or
     not exists (select 1 from pg_catalog.pg_indexes where schemaname = 'public'
      and indexname = 'generation_jobs_daily_count') then
    raise exception 'REQUIRED_INDEX_MISSING';
  end if;
  if (select count(*) from pg_catalog.pg_constraint
      where conrelid = 'public.generation_jobs'::regclass and contype = 'f') < 2 or
     (select count(*) from pg_catalog.pg_constraint
      where conrelid = 'public.generation_attempts'::regclass and contype = 'f') < 2 then
    raise exception 'FOREIGN_KEY_MISSING';
  end if;

  -- The official Supabase testing guide permits these transaction-scoped Auth
  -- fixtures; no permanent user or completed job survives the rollback.
  insert into auth.users(id, email) values
    (owner_a, 'phase1c-a-' || owner_a || '@example.com'),
    (owner_b, 'phase1c-b-' || owner_b || '@example.com'),
    (owner_c, 'phase1c-c-' || owner_c || '@example.com');

  insert into public.automation_runs(owner_user_id, run_date_taipei, state)
    values (owner_a, date '2000-01-01', 'running') returning run_id into run_a;
  insert into public.automation_runs(owner_user_id, run_date_taipei, state)
    values (owner_a, date '2000-01-02', 'running') returning run_id into run_a_next;
  begin
    insert into public.automation_runs(owner_user_id, run_date_taipei, state)
      values (owner_a, date '2000-01-03', 'not_a_run_state');
    raise exception 'RUN_STATE_CHECK_NOT_ENFORCED';
  exception when check_violation then null;
  end;
  begin
    insert into public.automation_control(owner_user_id) values (gen_random_uuid());
    raise exception 'AUTH_OWNER_FK_NOT_ENFORCED';
  exception when foreign_key_violation then null;
  end;
  insert into public.generation_jobs(owner_user_id, run_id, word_id, course_id,
    headword, prompt_text, prompt_hash, dataset_hash, state, counted_at)
    values
    (owner_a, run_a, 'tw_w_000000000001', 'core-1200', 'phase1c', 'phase1c', prompt_hash,
      repeat('c', 64), 'completed', timestamptz '2026-09-21 15:59:59+00'),
    (owner_a, run_a, 'tw_w_000000000002', 'core-1200', 'phase1c', 'phase1c', prompt_hash,
      repeat('c', 64), 'completed', timestamptz '2026-09-21 16:00:01+00'),
    (owner_a, run_a_next, 'tw_w_000000000003', 'core-1200', 'phase1c', 'phase1c', prompt_hash,
      repeat('c', 64), 'completed', timestamptz '2026-09-21 16:00:02+00');
  begin
    insert into public.generation_jobs(owner_user_id, run_id, word_id, course_id,
      headword, prompt_text, prompt_hash, dataset_hash, state, counted_at)
      values (owner_a, run_a, 'tw_w_000000000001', 'core-1200',
        'phase1c', 'phase1c', prompt_hash, repeat('c', 64), 'completed', clock_timestamp());
    raise exception 'RUN_WORD_UNIQUE_NOT_ENFORCED';
  exception when unique_violation then null;
  end;

  if automation_private.daily_count(owner_a, date '2026-09-21') <> 1 or
     automation_private.daily_count(owner_a, date '2026-09-22') <> 2 then
    raise exception 'TAIPEI_MIDNIGHT_OR_CROSS_RUN_COUNT_WRONG';
  end if;

  insert into public.automation_runs(owner_user_id, run_date_taipei, state)
    values (owner_b, counted_day, 'running') returning run_id into run_b;
  insert into public.generation_jobs(owner_user_id, run_id, word_id, course_id,
    headword, prompt_text, prompt_hash, dataset_hash, state, counted_at)
    select owner_b, run_b, 'tw_w_' || lpad(to_hex(n), 12, '0'), 'core-1200',
      'phase1c', 'phase1c', prompt_hash, repeat('c', 64), 'completed',
      (counted_day::timestamp at time zone 'Asia/Taipei') + interval '12 hours'
      from pg_catalog.generate_series(1, 100) as values_to_seed(n);
  if automation_private.daily_count(owner_b, counted_day) <> 100 then
    raise exception 'DAILY_COUNT_NOT_100';
  end if;

  insert into public.automation_control(owner_user_id, active_run_id, desired_action,
    worker_instance_id, lease_token, lease_generation, lease_expires_at)
    values (owner_b, run_b, 'START', 'phase1c-sql', token_b, 1,
      clock_timestamp() + interval '30 seconds');
  perform pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
  claim_result := public.automation_claim_job(owner_b, token_b, 1, run_b,
    'tw_w_fffffffffffe', 'core-1200', 'phase1c', 'phase1c', prompt_hash, repeat('c', 64));
  select state into run_state from public.automation_runs where run_id = run_b;
  if claim_result->>'status' <> 'DAILY_CAP' or run_state <> 'capped' or
     exists (select 1 from public.generation_jobs where run_id = run_b and word_id = 'tw_w_fffffffffffe') then
    raise exception 'CLAIM_101_WAS_NOT_CAPPED';
  end if;

  -- A run opened yesterday can complete its retained A today. The database
  -- assigns counted_at now, so this must count on today's Taipei date.
  insert into public.automation_runs(owner_user_id, run_date_taipei, state)
    values (owner_c, counted_day - 1, 'running') returning run_id into run_c;
  insert into public.generation_jobs(owner_user_id, run_id, word_id, course_id,
    headword, prompt_text, prompt_hash, dataset_hash, state)
    values (owner_c, run_c, 'tw_w_eeeeeeeeeeee', 'core-1200',
      'phase1c', 'phase1c', prompt_hash, repeat('c', 64), 'active')
    returning job_id into job_c;
  insert into public.generation_attempts(attempt_id, owner_user_id, job_id, attempt_no, state,
    artifact_locator, artifact_sha256, artifact_bytes, artifact_media_type,
    publish_request_id)
    values (attempt_c, owner_c, job_c, 1, 'publishing',
      'artifacts/' || job_c || '/' || attempt_c || '.webp',
      repeat('a', 64), 64, 'image/webp', publish_c);
  update public.generation_jobs set active_attempt_id = attempt_c where job_id = job_c;
  insert into public.automation_control(owner_user_id, active_run_id, active_job_id,
    desired_action, worker_instance_id, lease_token, lease_generation, lease_expires_at)
    values (owner_c, run_c, job_c, 'START', 'phase1c-midnight', token_c, 1,
      clock_timestamp() + interval '30 seconds');
  perform public.automation_complete_publication(owner_c, token_c, 1, job_c, attempt_c,
    pg_catalog.jsonb_build_object(
      'success', true, 'verifiedAtCommit', true, 'activeAtVerification', true,
      'verifiedAt', clock_timestamp(), 'wordId', 'tw_w_eeeeeeeeeeee', 'version', 1,
      'imageKey', 'words/tw_w_eeeeeeeeeeee/v1.webp', 'sha256', repeat('a', 64),
      'publishRequestId', publish_c, 'ledgerCommitted', true, 'manifestCommitted', true,
      'publication', pg_catalog.jsonb_build_object('objectStored', true,
        'ledgerCommitted', true, 'manifestCommitted', true, 'verified', true)
    ));
  if automation_private.daily_count(owner_c, counted_day) <> 1 or
     automation_private.daily_count(owner_c, counted_day - 1) <> 0 then
    raise exception 'PREVIOUS_DAY_JOB_COUNTED_ON_WRONG_DATE';
  end if;

  raise notice 'Phase 1C SQL catalog, grant, timezone and cap checks passed; rolling back fixtures';
end
$phase1c$;

rollback;
