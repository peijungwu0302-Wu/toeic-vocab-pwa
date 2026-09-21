-- Phase 1B RPC surface. External Gemini/R2 calls occur outside DB transactions.
-- Every worker mutation is fenced by owner-scoped lease token + generation.

create schema if not exists automation_private;
revoke all on schema automation_private from public, anon, authenticated;

create function automation_private.assert_worker()
returns void language plpgsql set search_path = '' as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'WORKER_CREDENTIAL_REQUIRED' using errcode = '42501';
  end if;
end $$;

create function automation_private.require_lease(p_owner uuid, p_token uuid, p_generation bigint)
returns public.automation_control language plpgsql set search_path = '' as $$
declare v_control public.automation_control;
begin
  select * into v_control from public.automation_control
    where owner_user_id = p_owner for update;
  if not found or p_token is null or v_control.lease_token is null or
     v_control.lease_token is distinct from p_token or
     v_control.lease_generation is distinct from p_generation or
     v_control.lease_expires_at is null or v_control.lease_expires_at <= clock_timestamp() then
    raise exception 'STALE_LEASE' using errcode = 'P0001';
  end if;
  return v_control;
end $$;

create function automation_private.daily_count(p_owner uuid, p_day date)
returns bigint language sql stable set search_path = '' as $$
  select count(*) from public.generation_jobs
  where owner_user_id = p_owner and state = 'completed'
    and counted_at >= (p_day::timestamp at time zone 'Asia/Taipei')
    and counted_at < ((p_day + 1)::timestamp at time zone 'Asia/Taipei');
$$;

revoke all on function automation_private.assert_worker() from public, anon, authenticated, service_role;
revoke all on function automation_private.require_lease(uuid, uuid, bigint) from public, anon, authenticated, service_role;
revoke all on function automation_private.daily_count(uuid, date) from public, anon, authenticated, service_role;

create function public.automation_bootstrap_owner(p_owner uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform automation_private.assert_worker();
  insert into public.automation_control(owner_user_id) values (p_owner)
    on conflict (owner_user_id) do nothing;
end $$;
revoke all on function public.automation_bootstrap_owner(uuid) from public, anon, authenticated;
grant execute on function public.automation_bootstrap_owner(uuid) to service_role;

create function public.automation_request_command(
  p_owner uuid, p_command_id uuid, p_expected_seq bigint,
  p_action text, p_target_run uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_control public.automation_control;
  v_run public.automation_runs;
  v_today date := (clock_timestamp() at time zone 'Asia/Taipei')::date;
  v_result jsonb;
begin
  if auth.uid() is null or auth.uid() <> p_owner then
    raise exception 'OWNER_MISMATCH' using errcode = '42501';
  end if;
  if p_command_id is null or p_action is null or p_action not in ('START', 'PAUSE', 'STOP') or
     (p_action = 'START' and p_target_run is not null) then
    raise exception 'INVALID_COMMAND' using errcode = 'P0001';
  end if;
  select * into v_control from public.automation_control
    where owner_user_id = p_owner for update;
  if not found then raise exception 'OWNER_NOT_BOOTSTRAPPED' using errcode = 'P0001'; end if;
  if v_control.last_command_id = p_command_id then
    if v_control.last_command_action is distinct from p_action or
       v_control.last_command_target_run_id is distinct from p_target_run then
      raise exception 'COMMAND_ID_REUSED' using errcode = 'P0001';
    end if;
    return v_control.last_command_result;
  end if;
  if p_expected_seq is null or v_control.command_seq <> p_expected_seq then
    raise exception 'STALE_COMMAND' using errcode = 'P0001';
  end if;

  if p_action = 'START' then
    if v_control.active_job_id is not null and
       (select run_date_taipei from public.automation_runs where run_id = v_control.active_run_id) <> v_today then
      raise exception 'ACTIVE_JOB_EXISTS' using errcode = 'P0001';
    end if;
    select * into v_run from public.automation_runs
      where owner_user_id = p_owner and run_date_taipei = v_today for update;
    if not found then
      if v_control.active_job_id is not null then
        raise exception 'ACTIVE_JOB_EXISTS' using errcode = 'P0001';
      end if;
      if v_control.active_run_id is not null then
        update public.automation_runs set state = 'finished', ended_at = clock_timestamp()
          where run_id = v_control.active_run_id and state in ('running', 'paused', 'pause_requested');
      end if;
      insert into public.automation_runs(owner_user_id, run_date_taipei, state, started_at)
        values (p_owner, v_today, 'running', clock_timestamp()) returning * into v_run;
    else
      if v_run.state in ('stopped', 'hard_stopped', 'capped', 'finished', 'stop_requested') then
        raise exception 'RUN_TERMINAL' using errcode = 'P0001';
      end if;
      update public.automation_runs set state = 'running', started_at = coalesce(started_at, clock_timestamp())
        where run_id = v_run.run_id returning * into v_run;
    end if;
    update public.automation_control set active_run_id = v_run.run_id, desired_action = 'START'
      where owner_user_id = p_owner;
  else
    if p_target_run is null or v_control.active_run_id is distinct from p_target_run then
      raise exception 'WRONG_RUN' using errcode = 'P0001';
    end if;
    select * into v_run from public.automation_runs where run_id = p_target_run for update;
    if p_action = 'PAUSE' then
      if v_run.state not in ('running', 'paused', 'pause_requested') then
        raise exception 'RUN_TERMINAL' using errcode = 'P0001';
      end if;
      update public.automation_runs set state = case when v_control.active_job_id is null then 'paused' else 'pause_requested' end
        where run_id = v_run.run_id returning * into v_run;
    else
      if v_run.state in ('stopped', 'hard_stopped', 'capped', 'finished') then
        raise exception 'RUN_TERMINAL' using errcode = 'P0001';
      end if;
      update public.automation_runs set
        state = case when v_control.active_job_id is null then 'stopped' else 'stop_requested' end,
        ended_at = case when v_control.active_job_id is null then clock_timestamp() else ended_at end
        where run_id = v_run.run_id returning * into v_run;
    end if;
    update public.automation_control set desired_action = p_action where owner_user_id = p_owner;
  end if;

  v_result := jsonb_build_object('commandSeq', v_control.command_seq + 1,
    'runId', v_run.run_id, 'runState', v_run.state);
  update public.automation_control set command_seq = command_seq + 1,
    last_command_id = p_command_id, last_command_action = p_action,
    last_command_target_run_id = p_target_run, last_command_result = v_result,
    updated_at = clock_timestamp() where owner_user_id = p_owner;
  return v_result;
end $$;
revoke all on function public.automation_request_command(uuid, uuid, bigint, text, uuid) from public, anon, service_role;
grant execute on function public.automation_request_command(uuid, uuid, bigint, text, uuid) to authenticated;

create function public.automation_daily_success_count(p_owner uuid, p_day date)
returns bigint language plpgsql security definer set search_path = '' as $$
begin
  if (auth.uid() is null or auth.uid() <> p_owner) and
     coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'OWNER_MISMATCH' using errcode = '42501';
  end if;
  return automation_private.daily_count(p_owner, p_day);
end $$;
revoke all on function public.automation_daily_success_count(uuid, date) from public, anon;
grant execute on function public.automation_daily_success_count(uuid, date) to authenticated, service_role;

create function public.automation_acquire_lease(p_owner uuid, p_instance text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_control public.automation_control;
begin
  perform automation_private.assert_worker();
  if nullif(p_instance, '') is null then raise exception 'INVALID_WORKER_INSTANCE' using errcode = 'P0001'; end if;
  select * into v_control from public.automation_control where owner_user_id = p_owner for update;
  if not found then raise exception 'OWNER_NOT_BOOTSTRAPPED' using errcode = 'P0001'; end if;
  if v_control.lease_token is not null and v_control.lease_expires_at > clock_timestamp() then
    if v_control.worker_instance_id <> p_instance then raise exception 'LEASE_HELD' using errcode = 'P0001'; end if;
    return jsonb_build_object('leaseToken', v_control.lease_token,
      'leaseGeneration', v_control.lease_generation, 'activeJobId', v_control.active_job_id);
  end if;
  update public.automation_control set worker_instance_id = p_instance,
    lease_token = gen_random_uuid(), lease_generation = lease_generation + 1,
    lease_expires_at = clock_timestamp() + interval '30 seconds', heartbeat_at = clock_timestamp(),
    updated_at = clock_timestamp() where owner_user_id = p_owner returning * into v_control;
  return jsonb_build_object('leaseToken', v_control.lease_token,
    'leaseGeneration', v_control.lease_generation, 'activeJobId', v_control.active_job_id);
end $$;
revoke all on function public.automation_acquire_lease(uuid, text) from public, anon, authenticated;
grant execute on function public.automation_acquire_lease(uuid, text) to service_role;

create function public.automation_renew_lease(p_owner uuid, p_token uuid, p_generation bigint)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_control public.automation_control;
begin
  perform automation_private.assert_worker();
  v_control := automation_private.require_lease(p_owner, p_token, p_generation);
  update public.automation_control set lease_expires_at = clock_timestamp() + interval '30 seconds',
    heartbeat_at = clock_timestamp(), updated_at = clock_timestamp()
    where owner_user_id = p_owner returning * into v_control;
  return v_control.lease_expires_at;
end $$;
revoke all on function public.automation_renew_lease(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.automation_renew_lease(uuid, uuid, bigint) to service_role;

create function public.automation_release_lease(p_owner uuid, p_token uuid, p_generation bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_control public.automation_control;
begin
  perform automation_private.assert_worker();
  v_control := automation_private.require_lease(p_owner, p_token, p_generation);
  if v_control.active_job_id is not null then raise exception 'ACTIVE_JOB_EXISTS' using errcode = 'P0001'; end if;
  update public.automation_control set worker_instance_id = null, lease_token = null,
    lease_expires_at = null, heartbeat_at = null, updated_at = clock_timestamp()
    where owner_user_id = p_owner;
end $$;
revoke all on function public.automation_release_lease(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.automation_release_lease(uuid, uuid, bigint) to service_role;

-- The worker calls this only after a fresh Manifest yields no remaining
-- flagship candidates. The database deliberately does not infer image presence.
create function public.automation_finish_run(
  p_owner uuid, p_token uuid, p_generation bigint, p_run uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_control public.automation_control;
  v_run public.automation_runs;
begin
  perform automation_private.assert_worker();
  v_control := automation_private.require_lease(p_owner, p_token, p_generation);
  if v_control.active_job_id is not null or v_control.active_run_id is distinct from p_run or
     v_control.desired_action <> 'START' then
    raise exception 'RUN_NOT_FINISHABLE' using errcode = 'P0001';
  end if;
  select * into v_run from public.automation_runs
    where run_id = p_run and owner_user_id = p_owner for update;
  if not found or v_run.state <> 'running' then
    raise exception 'RUN_NOT_FINISHABLE' using errcode = 'P0001';
  end if;
  update public.automation_runs set state = 'finished', ended_at = clock_timestamp()
    where run_id = p_run;
  update public.automation_control set desired_action = 'STOP', updated_at = clock_timestamp()
    where owner_user_id = p_owner;
end $$;
revoke all on function public.automation_finish_run(uuid, uuid, bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.automation_finish_run(uuid, uuid, bigint, uuid)
  to service_role;

create function public.automation_claim_job(
  p_owner uuid, p_token uuid, p_generation bigint, p_run uuid,
  p_word_id text, p_course_id text, p_headword text,
  p_prompt_text text, p_prompt_hash text, p_dataset_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_control public.automation_control;
  v_run public.automation_runs;
  v_job uuid;
  v_attempt uuid;
  v_today date := (clock_timestamp() at time zone 'Asia/Taipei')::date;
begin
  perform automation_private.assert_worker();
  v_control := automation_private.require_lease(p_owner, p_token, p_generation);
  if v_control.active_job_id is not null then raise exception 'ACTIVE_JOB_EXISTS' using errcode = 'P0001'; end if;
  if v_control.active_run_id is distinct from p_run or v_control.desired_action <> 'START' then
    raise exception 'RUN_NOT_CLAIMABLE' using errcode = 'P0001';
  end if;
  select * into v_run from public.automation_runs where run_id = p_run and owner_user_id = p_owner for update;
  if not found or v_run.state <> 'running' or v_run.run_date_taipei <> v_today then
    raise exception 'RUN_NOT_CLAIMABLE' using errcode = 'P0001';
  end if;
  if automation_private.daily_count(p_owner, v_today) >= 100 then
    update public.automation_runs set state = 'capped', ended_at = clock_timestamp() where run_id = p_run;
    update public.automation_control set desired_action = 'STOP' where owner_user_id = p_owner;
    return jsonb_build_object('status', 'DAILY_CAP', 'runId', p_run);
  end if;
  if p_prompt_text is null or p_prompt_hash is distinct from
       pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_prompt_text, 'UTF8')), 'hex') or
     p_dataset_hash is null or p_dataset_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'INVALID_CANDIDATE' using errcode = 'P0001';
  end if;
  if v_run.dataset_hash is null then
    update public.automation_runs set dataset_hash = p_dataset_hash where run_id = p_run;
  elsif v_run.dataset_hash <> p_dataset_hash then
    raise exception 'DATASET_CHANGED' using errcode = 'P0001';
  end if;
  if exists(select 1 from public.generation_jobs where run_id = p_run and word_id = p_word_id) then
    raise exception 'DUPLICATE_WORD' using errcode = 'P0001';
  end if;
  insert into public.generation_jobs(owner_user_id, run_id, word_id, course_id,
    headword, prompt_text, prompt_hash, dataset_hash, state)
    values (p_owner, p_run, p_word_id, p_course_id, p_headword,
      p_prompt_text, p_prompt_hash, p_dataset_hash, 'active') returning job_id into v_job;
  insert into public.generation_attempts(owner_user_id, job_id, attempt_no, state)
    values (p_owner, v_job, 1, 'created') returning attempt_id into v_attempt;
  update public.generation_jobs set active_attempt_id = v_attempt where job_id = v_job;
  update public.automation_control set active_job_id = v_job, updated_at = clock_timestamp()
    where owner_user_id = p_owner;
  return jsonb_build_object('status', 'CLAIMED', 'jobId', v_job,
    'attemptId', v_attempt, 'wordId', p_word_id);
end $$;
revoke all on function public.automation_claim_job(uuid, uuid, bigint, uuid, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.automation_claim_job(uuid, uuid, bigint, uuid, text, text, text, text, text, text)
  to service_role;

create function public.automation_advance_attempt(
  p_owner uuid, p_token uuid, p_generation bigint, p_attempt uuid, p_next_state text,
  p_response_marker text default null, p_artifact_locator text default null,
  p_artifact_sha256 text default null, p_artifact_bytes bigint default null,
  p_publish_request_id uuid default null, p_error_code text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_control public.automation_control;
  v_job public.generation_jobs;
  v_attempt public.generation_attempts;
begin
  perform automation_private.assert_worker();
  v_control := automation_private.require_lease(p_owner, p_token, p_generation);
  select * into v_attempt from public.generation_attempts
    where attempt_id = p_attempt and owner_user_id = p_owner for update;
  if not found then raise exception 'ATTEMPT_NOT_FOUND' using errcode = 'P0001'; end if;
  select * into v_job from public.generation_jobs where job_id = v_attempt.job_id for update;
  if v_control.active_job_id is distinct from v_job.job_id or
     v_job.active_attempt_id is distinct from p_attempt or v_job.state <> 'active' then
    raise exception 'ATTEMPT_NOT_ACTIVE' using errcode = 'P0001';
  end if;
  if v_attempt.state = 'created' and p_next_state = 'prompt_submitted' or
     v_attempt.state = 'prompt_submitted' and p_next_state = 'response_verified' or
     v_attempt.state = 'response_verified' and p_next_state = 'downloaded' then
    if p_next_state = 'response_verified' and nullif(p_response_marker, '') is null then
      raise exception 'RESPONSE_MARKER_REQUIRED' using errcode = 'P0001';
    end if;
    update public.generation_attempts set state = p_next_state,
      response_marker = case when p_next_state = 'response_verified' then p_response_marker else response_marker end,
      updated_at = clock_timestamp() where attempt_id = p_attempt;
  elsif v_attempt.state = 'downloaded' and p_next_state = 'artifact_verified' then
    if p_artifact_locator is distinct from
       pg_catalog.format('artifacts/%s/%s.webp', v_job.job_id, p_attempt) or
       p_artifact_sha256 is null or p_artifact_sha256 !~ '^[a-f0-9]{64}$' or
       p_artifact_bytes is null or p_artifact_bytes <= 0 then
      raise exception 'INVALID_ARTIFACT' using errcode = 'P0001';
    end if;
    update public.generation_attempts set state = 'artifact_verified',
      artifact_locator = p_artifact_locator, artifact_sha256 = p_artifact_sha256,
      artifact_bytes = p_artifact_bytes, artifact_media_type = 'image/webp',
      updated_at = clock_timestamp() where attempt_id = p_attempt;
  elsif v_attempt.state = 'artifact_verified' and p_next_state = 'publishing' then
    if p_publish_request_id is null then raise exception 'PUBLISH_REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
    update public.generation_attempts set state = 'publishing',
      publish_request_id = p_publish_request_id, updated_at = clock_timestamp()
      where attempt_id = p_attempt;
  elsif v_attempt.state = 'publishing' and p_next_state = 'publishing' then
    if p_publish_request_id is distinct from v_attempt.publish_request_id or
       (p_artifact_sha256 is not null and p_artifact_sha256 is distinct from v_attempt.artifact_sha256) then
      raise exception 'ARTIFACT_IDENTITY_CHANGED' using errcode = 'P0001';
    end if;
  elsif v_attempt.state = 'publishing' and p_next_state = 'reconciliation_required' then
    if nullif(p_error_code, '') is null then raise exception 'ERROR_CODE_REQUIRED' using errcode = 'P0001'; end if;
    update public.generation_attempts set state = 'reconciliation_required',
      last_error_code = p_error_code, updated_at = clock_timestamp() where attempt_id = p_attempt;
    update public.generation_jobs set state = 'publication_uncertain', last_error_code = p_error_code
      where job_id = v_job.job_id;
    update public.automation_runs set state = 'hard_stopped', last_error_code = p_error_code,
      hard_stop_reason = 'Publication requires reconciliation', ended_at = clock_timestamp()
      where run_id = v_job.run_id;
    update public.automation_control set desired_action = 'STOP', updated_at = clock_timestamp()
      where owner_user_id = p_owner;
    -- Deliberately retain active_job_id: lease takeover cannot advance Job B.
  else
    raise exception 'INVALID_ATTEMPT_TRANSITION' using errcode = 'P0001';
  end if;
  return jsonb_build_object('attemptId', p_attempt, 'state', p_next_state,
    'jobId', v_job.job_id);
end $$;
revoke all on function public.automation_advance_attempt(uuid, uuid, bigint, uuid, text, text, text, text, bigint, uuid, text)
  from public, anon, authenticated;
grant execute on function public.automation_advance_attempt(uuid, uuid, bigint, uuid, text, text, text, text, bigint, uuid, text)
  to service_role;

-- A new Gemini attempt is permitted only after a confirmed pre-submission failure.
-- An uncertain prompt or publication cannot be cleared by this path.
create function public.automation_fail_safe_attempt(
  p_owner uuid, p_token uuid, p_generation bigint, p_attempt uuid, p_reason text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_control public.automation_control;
  v_job public.generation_jobs;
  v_attempt public.generation_attempts;
begin
  perform automation_private.assert_worker();
  v_control := automation_private.require_lease(p_owner, p_token, p_generation);
  select * into v_attempt from public.generation_attempts
    where attempt_id = p_attempt and owner_user_id = p_owner for update;
  if not found then raise exception 'ATTEMPT_NOT_FOUND' using errcode = 'P0001'; end if;
  select * into v_job from public.generation_jobs where job_id = v_attempt.job_id for update;
  if v_control.active_job_id is distinct from v_job.job_id or
     v_job.active_attempt_id is distinct from p_attempt or
     v_job.state <> 'active' or v_attempt.state <> 'created' or
     nullif(p_reason, '') is null then
    raise exception 'UNSAFE_FRESH_GENERATION' using errcode = 'P0001';
  end if;
  update public.generation_attempts set state = 'failed_safe',
    last_error_code = p_reason, updated_at = clock_timestamp()
    where attempt_id = p_attempt;
end $$;
revoke all on function public.automation_fail_safe_attempt(uuid, uuid, bigint, uuid, text)
  from public, anon, authenticated;
grant execute on function public.automation_fail_safe_attempt(uuid, uuid, bigint, uuid, text)
  to service_role;

create function public.automation_new_attempt(
  p_owner uuid, p_token uuid, p_generation bigint, p_job uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_control public.automation_control;
  v_job public.generation_jobs;
  v_previous public.generation_attempts;
  v_attempt uuid;
begin
  perform automation_private.assert_worker();
  v_control := automation_private.require_lease(p_owner, p_token, p_generation);
  select * into v_job from public.generation_jobs
    where job_id = p_job and owner_user_id = p_owner for update;
  if not found or v_control.active_job_id is distinct from p_job or v_job.state <> 'active' then
    raise exception 'ATTEMPT_NOT_ACTIVE' using errcode = 'P0001';
  end if;
  select * into v_previous from public.generation_attempts
    where attempt_id = v_job.active_attempt_id for update;
  if v_previous.state <> 'failed_safe' then
    raise exception 'UNSAFE_FRESH_GENERATION' using errcode = 'P0001';
  end if;
  insert into public.generation_attempts(owner_user_id, job_id, attempt_no, state)
    values (p_owner, p_job, v_previous.attempt_no + 1, 'created')
    returning attempt_id into v_attempt;
  update public.generation_jobs set active_attempt_id = v_attempt where job_id = p_job;
  return jsonb_build_object('jobId', p_job, 'attemptId', v_attempt);
end $$;
revoke all on function public.automation_new_attempt(uuid, uuid, bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.automation_new_attempt(uuid, uuid, bigint, uuid)
  to service_role;

create function public.automation_complete_publication(
  p_owner uuid, p_token uuid, p_generation bigint,
  p_job uuid, p_attempt uuid, p_receipt jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_control public.automation_control;
  v_run public.automation_runs;
  v_job public.generation_jobs;
  v_attempt public.generation_attempts;
  v_version integer;
  v_expected_key text;
begin
  perform automation_private.assert_worker();
  v_control := automation_private.require_lease(p_owner, p_token, p_generation);
  select * into v_job from public.generation_jobs
    where job_id = p_job and owner_user_id = p_owner for update;
  if not found then raise exception 'WRONG_JOB' using errcode = 'P0001'; end if;
  select * into v_attempt from public.generation_attempts
    where attempt_id = p_attempt and job_id = p_job and owner_user_id = p_owner for update;
  if not found or v_job.active_attempt_id is distinct from p_attempt then
    raise exception 'WRONG_ATTEMPT' using errcode = 'P0001';
  end if;
  if p_receipt is null or p_receipt->>'success' is distinct from 'true' or
     p_receipt->>'verifiedAtCommit' is distinct from 'true' or
     p_receipt->>'wordId' is distinct from v_job.word_id or
     p_receipt->>'sha256' is distinct from v_attempt.artifact_sha256 or
     p_receipt->>'publishRequestId' is distinct from v_attempt.publish_request_id::text or
     p_receipt->'publication'->>'objectStored' is distinct from 'true' or
     p_receipt->'publication'->>'ledgerCommitted' is distinct from 'true' or
     p_receipt->'publication'->>'manifestCommitted' is distinct from 'true' or
     p_receipt->'publication'->>'verified' is distinct from 'true' or
     p_receipt->>'ledgerCommitted' is distinct from 'true' or
     p_receipt->>'manifestCommitted' is distinct from 'true' then
    raise exception 'RECEIPT_MISMATCH' using errcode = 'P0001';
  end if;
  if p_receipt->>'version' is null or (p_receipt->>'version') !~ '^[1-9][0-9]*$' then
    raise exception 'RECEIPT_MISMATCH' using errcode = 'P0001';
  end if;
  v_version := (p_receipt->>'version')::integer;
  v_expected_key := pg_catalog.format('words/%s/v%s.webp', v_job.word_id, v_version);
  if p_receipt->>'imageKey' is distinct from v_expected_key then
    raise exception 'RECEIPT_MISMATCH' using errcode = 'P0001';
  end if;

  -- A completed job remains historically completed after later supersession.
  -- Check fencing first, then return its original counted_at without recounting.
  if v_job.state = 'completed' then
    if v_attempt.state <> 'publication_verified' or
       v_attempt.publication_version <> v_version or
       v_attempt.publication_image_key is distinct from v_expected_key then
      raise exception 'RECEIPT_MISMATCH' using errcode = 'P0001';
    end if;
    return jsonb_build_object('jobId', p_job, 'countedAt', v_job.counted_at,
      'idempotentReplay', true);
  end if;
  if v_control.active_job_id is distinct from p_job or v_job.state <> 'active' or
     v_attempt.state <> 'publishing' then
    raise exception 'ATTEMPT_NOT_ACTIVE' using errcode = 'P0001';
  end if;
  if p_receipt->>'activeAtVerification' is distinct from 'true' or
     nullif(p_receipt->>'verifiedAt', '') is null or
     (p_receipt->>'verifiedAt')::timestamptz is null then
    raise exception 'PUBLICATION_NOT_ACTIVE' using errcode = 'P0001';
  end if;
  select * into v_run from public.automation_runs where run_id = v_job.run_id for update;
  if v_run.state not in ('running', 'pause_requested', 'stop_requested') then
    raise exception 'RUN_NOT_COMPLETABLE' using errcode = 'P0001';
  end if;
  update public.generation_attempts set state = 'publication_verified',
    publication_version = v_version, publication_image_key = v_expected_key,
    publication_receipt = p_receipt, updated_at = clock_timestamp()
    where attempt_id = p_attempt;
  update public.generation_jobs set state = 'completed',
    completed_at = clock_timestamp(), counted_at = clock_timestamp()
    where job_id = p_job returning * into v_job;
  update public.automation_control set active_job_id = null, updated_at = clock_timestamp()
    where owner_user_id = p_owner;
  if v_run.state = 'pause_requested' then
    update public.automation_runs set state = 'paused' where run_id = v_run.run_id;
  elsif v_run.state = 'stop_requested' then
    update public.automation_runs set state = 'stopped', ended_at = clock_timestamp()
      where run_id = v_run.run_id;
  elsif automation_private.daily_count(p_owner,
      (v_job.counted_at at time zone 'Asia/Taipei')::date) >= 100 then
    update public.automation_runs set state = 'capped', ended_at = clock_timestamp()
      where run_id = v_run.run_id;
    update public.automation_control set desired_action = 'STOP' where owner_user_id = p_owner;
  end if;
  return jsonb_build_object('jobId', p_job, 'countedAt', v_job.counted_at,
    'idempotentReplay', false);
end $$;
revoke all on function public.automation_complete_publication(uuid, uuid, bigint, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.automation_complete_publication(uuid, uuid, bigint, uuid, uuid, jsonb)
  to service_role;

create function public.automation_hard_stop(
  p_owner uuid, p_token uuid, p_generation bigint, p_error_code text, p_reason text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_control public.automation_control;
  v_job public.generation_jobs;
  v_attempt public.generation_attempts;
begin
  perform automation_private.assert_worker();
  v_control := automation_private.require_lease(p_owner, p_token, p_generation);
  if nullif(p_error_code, '') is null or nullif(p_reason, '') is null then
    raise exception 'ERROR_REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if v_control.active_job_id is not null then
    select * into v_job from public.generation_jobs where job_id = v_control.active_job_id for update;
    select * into v_attempt from public.generation_attempts
      where attempt_id = v_job.active_attempt_id for update;
    if v_job.state = 'publication_uncertain' or
       v_attempt.state in ('publishing', 'reconciliation_required') then
      update public.generation_attempts set state = 'reconciliation_required',
        last_error_code = p_error_code, updated_at = clock_timestamp()
        where attempt_id = v_attempt.attempt_id;
      update public.generation_jobs set state = 'publication_uncertain', last_error_code = p_error_code
        where job_id = v_job.job_id;
    else
      update public.generation_attempts set state = 'blocked',
        last_error_code = p_error_code, updated_at = clock_timestamp()
        where attempt_id = v_attempt.attempt_id;
      update public.generation_jobs set state = 'blocked', last_error_code = p_error_code
        where job_id = v_job.job_id;
    end if;
  end if;
  if v_control.active_run_id is not null then
    update public.automation_runs set state = 'hard_stopped',
      last_error_code = p_error_code, hard_stop_reason = p_reason,
      ended_at = clock_timestamp() where run_id = v_control.active_run_id;
  end if;
  update public.automation_control set desired_action = 'STOP', updated_at = clock_timestamp()
    where owner_user_id = p_owner;
end $$;
revoke all on function public.automation_hard_stop(uuid, uuid, bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.automation_hard_stop(uuid, uuid, bigint, text, text)
  to service_role;

create function public.automation_recovery_snapshot(p_owner uuid, p_token uuid, p_generation bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_control public.automation_control;
  v_job public.generation_jobs;
  v_attempt public.generation_attempts;
begin
  perform automation_private.assert_worker();
  v_control := automation_private.require_lease(p_owner, p_token, p_generation);
  if v_control.active_job_id is null then
    return jsonb_build_object('activeJob', null, 'attempt', null);
  end if;
  select * into v_job from public.generation_jobs where job_id = v_control.active_job_id;
  select * into v_attempt from public.generation_attempts where attempt_id = v_job.active_attempt_id;
  return jsonb_build_object('activeJob', to_jsonb(v_job), 'attempt', to_jsonb(v_attempt));
end $$;
revoke all on function public.automation_recovery_snapshot(uuid, uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.automation_recovery_snapshot(uuid, uuid, bigint)
  to service_role;
