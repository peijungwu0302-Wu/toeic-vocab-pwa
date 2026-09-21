-- The owner control row is the command/claim serialization point. Resolve the
-- Taipei calendar day after acquiring it, not before a potentially long wait.
create or replace function public.automation_request_command(
  p_owner uuid, p_command_id uuid, p_expected_seq bigint,
  p_action text, p_target_run uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_control public.automation_control;
  v_run public.automation_runs;
  v_today date;
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
    v_today := (clock_timestamp() at time zone 'Asia/Taipei')::date;
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

create or replace function public.automation_claim_job(
  p_owner uuid, p_token uuid, p_generation bigint, p_run uuid,
  p_word_id text, p_course_id text, p_headword text,
  p_prompt_text text, p_prompt_hash text, p_dataset_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_control public.automation_control;
  v_run public.automation_runs;
  v_job uuid;
  v_attempt uuid;
  v_today date;
begin
  perform automation_private.assert_worker();
  v_control := automation_private.require_lease(p_owner, p_token, p_generation);
  if v_control.active_job_id is not null then raise exception 'ACTIVE_JOB_EXISTS' using errcode = 'P0001'; end if;
  if v_control.active_run_id is distinct from p_run or v_control.desired_action <> 'START' then
    raise exception 'RUN_NOT_CLAIMABLE' using errcode = 'P0001';
  end if;
  select * into v_run from public.automation_runs where run_id = p_run and owner_user_id = p_owner for update;
  v_today := (clock_timestamp() at time zone 'Asia/Taipei')::date;
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
