-- Phase 1B. Apply only after reviewing the target project's existing Auth users.
-- No owner is bootstrapped here; call automation_bootstrap_owner with the real auth.users.id.
-- Supabase is an execution ledger, never the formal image authority.

create table public.automation_runs (
  run_id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  run_date_taipei date not null,
  dataset_hash text,
  state text not null default 'requested' check (state in (
    'requested', 'running', 'pause_requested', 'paused', 'stop_requested',
    'stopped', 'hard_stopped', 'capped', 'finished'
  )),
  last_error_code text,
  hard_stop_reason text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  unique (owner_user_id, run_date_taipei),
  unique (owner_user_id, run_id),
  check (dataset_hash is null or dataset_hash ~ '^[a-f0-9]{64}$')
);

create table public.generation_jobs (
  job_id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null,
  word_id text not null check (word_id ~ '^tw_[wp]_[a-f0-9]{12}$'),
  course_id text not null check (course_id in (
    'core-1200', 'advanced-2500', 'expert-high-part1',
    'expert-high-part2', 'expert-high-part3'
  )),
  headword text not null,
  prompt_text text not null check (length(prompt_text) > 0),
  prompt_hash text not null check (prompt_hash ~ '^[a-f0-9]{64}$'),
  dataset_hash text not null check (dataset_hash ~ '^[a-f0-9]{64}$'),
  state text not null default 'queued' check (state in (
    'queued', 'active', 'publication_uncertain', 'blocked', 'completed', 'cancelled'
  )),
  active_attempt_id uuid,
  last_error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  counted_at timestamptz,
  foreign key (owner_user_id, run_id) references public.automation_runs(owner_user_id, run_id),
  unique (run_id, word_id),
  unique (owner_user_id, job_id),
  check ((state = 'completed') = (counted_at is not null))
);

create table public.generation_attempts (
  attempt_id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null,
  attempt_no integer not null check (attempt_no > 0),
  state text not null default 'created' check (state in (
    'created', 'prompt_submitted', 'response_verified', 'downloaded',
    'artifact_verified', 'publishing', 'publication_verified',
    'failed_safe', 'reconciliation_required', 'blocked'
  )),
  response_marker text,
  artifact_locator text,
  artifact_sha256 text check (artifact_sha256 is null or artifact_sha256 ~ '^[a-f0-9]{64}$'),
  artifact_bytes bigint check (artifact_bytes is null or artifact_bytes > 0),
  artifact_media_type text check (artifact_media_type is null or artifact_media_type = 'image/webp'),
  publish_request_id uuid unique,
  publication_version integer check (publication_version is null or publication_version > 0),
  publication_image_key text,
  publication_receipt jsonb,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_user_id, job_id) references public.generation_jobs(owner_user_id, job_id),
  unique (job_id, attempt_no),
  unique (owner_user_id, attempt_id),
  check (artifact_locator is null or artifact_locator !~ '(^[A-Za-z]:|^/|\.\.)')
);

alter table public.generation_jobs
  add constraint generation_jobs_active_attempt_fk
  foreign key (owner_user_id, active_attempt_id)
  references public.generation_attempts(owner_user_id, attempt_id)
  deferrable initially deferred;

create table public.automation_control (
  owner_user_id uuid primary key references auth.users(id) on delete cascade,
  active_run_id uuid,
  active_job_id uuid,
  command_seq bigint not null default 0 check (command_seq >= 0),
  last_command_id uuid,
  last_command_action text check (last_command_action is null or last_command_action in ('START', 'PAUSE', 'STOP')),
  last_command_target_run_id uuid,
  last_command_result jsonb,
  desired_action text not null default 'STOP' check (desired_action in ('START', 'PAUSE', 'STOP')),
  worker_instance_id text,
  lease_token uuid,
  lease_generation bigint not null default 0 check (lease_generation >= 0),
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (owner_user_id, active_run_id) references public.automation_runs(owner_user_id, run_id),
  foreign key (owner_user_id, active_job_id) references public.generation_jobs(owner_user_id, job_id),
  check ((lease_token is null) = (lease_expires_at is null)),
  check ((lease_token is null) = (worker_instance_id is null))
);

-- Single active/uncertain job per owner, not globally. The claim RPC/control row is
-- authoritative; this index is a fail-closed backstop for future privileged code.
create unique index generation_jobs_one_unresolved_per_owner
  on public.generation_jobs(owner_user_id)
  where state in ('active', 'publication_uncertain', 'blocked');
create index automation_runs_owner_state on public.automation_runs(owner_user_id, state);
create index generation_jobs_daily_count on public.generation_jobs(owner_user_id, counted_at)
  where state = 'completed';
create index generation_jobs_run_state on public.generation_jobs(run_id, state);
create index generation_attempts_job on public.generation_attempts(job_id, attempt_no);

-- Immutable job snapshot and artifact/publish identity even for privileged direct SQL.
create function public.automation_protect_job_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if row(old.owner_user_id, old.run_id, old.word_id, old.course_id, old.headword,
         old.prompt_text, old.prompt_hash, old.dataset_hash)
     is distinct from
     row(new.owner_user_id, new.run_id, new.word_id, new.course_id, new.headword,
         new.prompt_text, new.prompt_hash, new.dataset_hash) then
    raise exception 'IMMUTABLE_JOB_SNAPSHOT' using errcode = 'P0001';
  end if;
  if old.counted_at is not null and new.counted_at is distinct from old.counted_at then
    raise exception 'IMMUTABLE_COUNTED_AT' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger automation_job_identity_guard before update on public.generation_jobs
  for each row execute function public.automation_protect_job_identity();

create function public.automation_protect_attempt_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if row(old.owner_user_id, old.job_id, old.attempt_no) is distinct from
     row(new.owner_user_id, new.job_id, new.attempt_no) or
     (old.artifact_locator is not null and old.artifact_locator is distinct from new.artifact_locator) or
     (old.artifact_sha256 is not null and old.artifact_sha256 is distinct from new.artifact_sha256) or
     (old.artifact_bytes is not null and old.artifact_bytes is distinct from new.artifact_bytes) or
     (old.publish_request_id is not null and old.publish_request_id is distinct from new.publish_request_id) or
     (old.publication_receipt is not null and old.publication_receipt is distinct from new.publication_receipt) then
    raise exception 'IMMUTABLE_ATTEMPT_IDENTITY' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger automation_attempt_identity_guard before update on public.generation_attempts
  for each row execute function public.automation_protect_attempt_identity();

alter table public.automation_runs enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.generation_attempts enable row level security;
alter table public.automation_control enable row level security;

create policy automation_runs_owner_read on public.automation_runs for select to authenticated
  using (owner_user_id = (select auth.uid()));
create policy generation_jobs_owner_read on public.generation_jobs for select to authenticated
  using (owner_user_id = (select auth.uid()));
create policy generation_attempts_owner_read on public.generation_attempts for select to authenticated
  using (owner_user_id = (select auth.uid()));
create policy automation_control_owner_read on public.automation_control for select to authenticated
  using (owner_user_id = (select auth.uid()));

revoke all on public.automation_runs, public.generation_jobs,
  public.generation_attempts, public.automation_control from public, anon, authenticated, service_role;
grant select on public.automation_runs, public.generation_jobs,
  public.generation_attempts to authenticated;
-- Owners may inspect status, but worker fencing credentials are not browser-readable.
grant select (owner_user_id, active_run_id, active_job_id, command_seq,
  last_command_id, last_command_result, desired_action, worker_instance_id,
  lease_expires_at, heartbeat_at, updated_at)
  on public.automation_control to authenticated;
revoke execute on function public.automation_protect_job_identity() from public, anon, authenticated, service_role;
revoke execute on function public.automation_protect_attempt_identity() from public, anon, authenticated, service_role;
