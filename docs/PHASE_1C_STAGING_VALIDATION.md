# Phase 1C: isolated PostgreSQL / Supabase validation

This repeatable harness must run against a **new, disposable TOEIC staging
project or development branch**, never the repo's `TOEIC-studio` production
project. Phase 1C had a separate, explicitly authorized production validation:
`0003`, `0004`, then corrective `0005` were applied there; unrelated `0001`
and `0002` were intentionally skipped. The guarded staging harness is not a
production migration path. This machine has no configured staging project,
Supabase CLI, Docker, `psql`, or local PostgreSQL server.

## Prerequisites and guarded invocation

1. Provision a fresh isolated Supabase project/branch with Auth enabled. Do
   not use the unrelated `ai-dev-orchestrator` project. Confirm any branch cost
   before creating it. Obtain its direct database host and server-side keys.
2. Install `psql` separately through the operator's approved workstation
   setup. Install this repo's existing npm dependencies; the runner never
   downloads packages. Direct `db.<staging-ref>.supabase.co` connectivity is
   required. The runner intentionally refuses pooler/ambiguous hosts.
3. Set these environment variables privately (CI secret store or a secure
   local session, never a frontend file or committed `.env`):

   - `SUPABASE_TEST_CONFIRMATION=ISOLATED_TEST_DATABASE`
   - `SUPABASE_TEST_PROJECT_REF=<isolated-ref>`
   - `SUPABASE_TEST_URL=https://<isolated-ref>.supabase.co`
   - `SUPABASE_PRODUCTION_URL=https://hgufhnytbkbmivhofqeu.supabase.co`
   - `SUPABASE_TEST_DB_HOST=db.<isolated-ref>.supabase.co`
   - `SUPABASE_TEST_DB_PASSWORD=<secret>`
   - For API tests: `SUPABASE_TEST_PUBLISHABLE_KEY` and
     `SUPABASE_TEST_SERVICE_ROLE_KEY` from **that isolated project**.

4. On a **fresh** staging database, run from the repo root:

   ```powershell
   powershell -NoProfile -ExecutionPolicy RemoteSigned -File scripts/run_phase1c_staging.ps1 -RunApiTests
   ```

The runner validates the project ref, TLS API host, exact direct database
host, explicit confirmation, and a hard denylist for the repo's production
ref **before opening a connection**. It then applies migrations `0001`,
`0002`, `0003`, `0004`, `0005` in one transaction, runs
`supabase/tests/phase1c_real_sql.sql` in a rollback-only fixture transaction,
and runs the opt-in Supabase API integration suite. An existing database with
those migrations already applied is not suitable for this first-run script;
use a fresh staging database rather than trying to replay non-idempotent
policies. To rerun catalog/API tests against the already-migrated isolated
database, add `-SkipMigrations` to the same guarded command.

The API suite creates confirmed, uniquely named temporary Auth users through
the isolated project's admin API and deletes them after each test. If a run
is interrupted, inspect staging for `phase1c-*` users and remove only those
fixtures after verifying their IDs. No service-role key is printed, written
to a snapshot, or sent to the browser client.

Without all staging variables, the API suite is skipped during normal
`npm test`; if any staging variable is set but the set is incomplete or
points at production, it fails closed before creating a client.

## Evidence produced

`phase1c_real_sql.sql` inspects real PostgreSQL catalogs for tables, RLS,
policies, PK/FK/indexes, table/column/function privileges, SECURITY DEFINER
and explicit function search paths. In a transaction it tests an invalid
state, owner FK, duplicate `(run_id, word_id)`, 23:59:59/00:00 Taipei date
classification, cross-run counting, claim #101 at the cap, and a retained
previous-day job completed after midnight. It rolls every fixture back.

The Supabase API suite uses real signed-in sessions for two users and a
server-only service-role client. It executes denied cross-owner reads,
browser DML and worker-RPC calls; concurrent lease, claim, completion,
mobile-command and STOP/claim requests; lease expiry/fencing; recovery from
safe, artifact-verified, publishing, uncertain and hard-stopped states; and
100 verified completions with idempotent replay. Lease expiry cases take
roughly 31 seconds each. The fake Phase 1B tests remain in the normal suite.

## Transaction linearization points

| Operation | Linearization / serialization point |
|---|---|
| Mobile command | `automation_control(owner_user_id) FOR UPDATE`; sequence check and increment before commit |
| Lease acquire/takeover | Same owner control row lock; token/generation update before commit |
| Worker mutation | `require_lease` takes that row lock and validates token, generation and expiry |
| Claim | Under owner lock, checks active slot, run state and daily count; inserts job/attempt and assigns `active_job_id` in one transaction |
| Completion | Under owner lock, checks current job/attempt and receipt; assigns `counted_at` once and clears `active_job_id` in one transaction |
| STOP vs claim | Both compete for the owner row lock. If STOP commits first, claim must fail; if claim commits first, STOP becomes `stop_requested` for that already-active A. |

The per-owner unresolved-job unique index is an additional fail-closed
backstop, not the primary serialization mechanism. External Gemini/R2 work
is not inside these transactions; a replacement worker must recover A and
honor the durable attempt state before any new external work.

## Review gates before further production use

- Save the staging migration, catalog, Auth/RLS, RPC, concurrency and cap
  outputs; investigate every failure. A skipped API suite is **not** a pass.
- Re-check SECURITY DEFINER ownership, `search_path`, `PUBLIC` execution,
  anon access, authenticated DML, NULL comparisons, role claims and trigger
  behavior on the actual PostgreSQL version.
- Confirm the staging project uses this repo's expected Supabase Auth/API
  configuration and that temporary users were removed.
- Run targeted fake tests, full Vitest, typecheck, production build and
  `git diff --check` after any SQL fix.
- Do not start the automation worker or use the production control plane until
  true concurrent requests and actual signed-in Auth sessions pass the real
  integration suite. The production SQL connector used for the initial Phase
  1C validation serialized requests and cannot establish that concurrency gate.
