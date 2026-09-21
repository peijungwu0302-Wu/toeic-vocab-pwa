# Phase 1B automation control plane (fake worker only)

This is a durable execution/control ledger, **not** image authority. The only
formal image authority is the fresh Runtime Manifest, and the only formal
publication path is `/api/publish`. No Gemini/browser worker or phone control UI
is installed by this phase.

## Apply and bootstrap

Apply `0003_automation_control_plane.sql` and `0004_automation_control_rpcs.sql`
through the project's reviewed Supabase migration process. They have not been
applied to a remote project by this change. After identifying the real owner in
`auth.users`, an administrator may invoke `automation_bootstrap_owner(owner UUID)`
with a service-role credential. No owner UUID/email is embedded in the migrations.
Never expose the service-role credential or R2 publisher secret in Portable Studio.

Authenticated owners can SELECT only their own run/job/attempt rows and the
non-secret status columns of their control row. They can send START/PAUSE/STOP
only through `automation_request_command`. `anon` has no access; authenticated
clients have no table DML or worker-RPC execution grants. The trusted service-role
worker uses the fenced RPCs, not direct table writes. Control rows are per owner.

## Execution contract

1. For each claim, the worker takes a candidate from the five flagship courses
   after fetching a **fresh** Runtime Manifest and subtracting its wordId set.
   Supabase cannot determine whether a formal image exists. The claim RPC checks
   the run, owner, lease, cap, uniqueness and prompt hash, then snapshots wordId,
   courseId, headword, promptText, SHA-256 of UTF-8 promptText, and datasetHash.
2. `automation_request_command` locks the owner control row. `command_id` replays
   only the most recently accepted command; an old `expected_command_seq` fails.
   STOP is not undone by a stale START, and a stopped/hard-stopped same-day run
   cannot be restarted by a new command. PAUSE/STOP with an active job wait for
   that job to finish; they do not release it.
3. The worker acquires a 30-second owner lease. Every mutation requires the
   current token and monotonic generation. An expired lease can be taken over,
   but the active job remains attached to the owner control row. A replacement
   first calls `automation_recovery_snapshot` and resumes/reconciles that job.
4. A job has one current attempt. A confirmed failure **before prompt submission**
   can be marked `failed_safe` and retried with a new attemptId. From
   `prompt_submitted` onward, uncertainty requires inspection/hard stop rather
   than blind regeneration. A downloaded artifact uses relative locator
   `artifacts/{jobId}/{attemptId}.webp`, SHA-256, byte size and WebP media type.
   The Windows artifact root is configuration, not a database absolute path.
5. A publish retry retains the same attemptId, artifact bytes/SHA, and
   publishRequestId. `PUBLISH_IN_FLIGHT` remains `publishing`. A partial receipt
   requiring reconciliation transitions A to `publication_uncertain`, hard-stops
   the run, and **retains** `active_job_id`; B cannot be claimed. Explicit
   reconciliation is an operator action, not an automatic new attempt.
6. `automation_complete_publication` checks the fenced worker, current job and
   attempt, artifact SHA, wordId, publishRequestId, version/key and Phase 0A
   verified receipt. Initial completion requires `activeAtVerification=true`.
   It assigns `counted_at` in the database exactly once. Repeated completion
   returns the original timestamp without recounting. Supabase completion is
   evidence of a prior verified publication, not a substitute for a fresh
   Runtime Manifest check.
7. When a fresh manifest leaves no flagship candidates, the worker calls
   fenced `automation_finish_run`. It cannot finish a run with an active job.

Run states: `requested → running → pause_requested → paused`, or
`running → stop_requested → stopped`, with `capped`, `finished`, and
`hard_stopped` as non-resurrectable terminal states for that day.

Job states: `queued → active → completed`, or `active → publication_uncertain`
or `active → blocked`; unresolved jobs continue blocking the owner.

Attempt states: `created → prompt_submitted → response_verified → downloaded →
artifact_verified → publishing → publication_verified`. `failed_safe` is
available only from `created`. `reconciliation_required` / `blocked` are
non-progressing until explicit operator resolution.

Daily cap is **100 distinct completed jobs by `counted_at` Taiwan calendar
date**, across runs. A job that began before midnight and completes after it
counts on the new date. The count is derived from durable rows, not a mutable
counter. A claim at cap returns `{ "status": "DAILY_CAP" }` and caps the run;
attempts, failures and replay do not count.

`automation/fakeControlPlane.ts` is a deterministic in-memory dry-run contract.
Its fake artifact/publisher have no browser, network, Supabase or R2 access.
It deliberately does not prove that the SQL migrations execute: a Postgres/
Supabase integration test and migration rollout are required before production
use. In particular, the future real worker must freshly read the manifest,
verify local artifact bytes against their stored SHA on recovery, and treat any
unknown external publish outcome as reconciliation-required rather than moving
to Job B.
