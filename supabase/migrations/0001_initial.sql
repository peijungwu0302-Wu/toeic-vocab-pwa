-- Migration: 0001_initial.sql
-- Purpose: Schema and Row-Level Security for Optional Cloud Sync in TOEIC Vocabulary PWA

-- 1. Profiles Table
create table if not exists public.profiles (
  user_id uuid not null primary key references auth.users(id) on delete cascade,
  display_name text not null,
  daily_new_cards_target int not null default 15,
  daily_review_target int not null default 50,
  desired_retention numeric(3, 2) not null default 0.90,
  fast_skim_duration_sec int not null default 4,
  preferred_accent text not null default 'US',
  auto_play_audio boolean not null default true,
  is_muted boolean not null default false,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile."
  on public.profiles for select
  using (auth.uid() = user_id);

create policy "Users can insert their own profile."
  on public.profiles for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own profile."
  on public.profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own profile."
  on public.profiles for delete
  using (auth.uid() = user_id);

-- 2. User Word Progress Table (FSRS State)
create table if not exists public.user_word_progress (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  word_id text not null,
  due timestamptz not null,
  stability numeric(10, 4) not null,
  difficulty numeric(10, 4) not null,
  elapsed_days int not null default 0,
  scheduled_days int not null default 0,
  reps int not null default 0,
  lapses int not null default 0,
  state smallint not null default 0,
  last_review timestamptz,
  is_suspended boolean not null default false,
  is_starred boolean not null default false,
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint uq_user_word unique (user_id, word_id)
);

create index if not exists idx_user_word_progress_due on public.user_word_progress (user_id, due);

alter table public.user_word_progress enable row level security;

create policy "Users can view their own word progress."
  on public.user_word_progress for select
  using (auth.uid() = user_id);

create policy "Users can insert their own word progress."
  on public.user_word_progress for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own word progress."
  on public.user_word_progress for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own word progress."
  on public.user_word_progress for delete
  using (auth.uid() = user_id);

-- 3. Review Logs (Immutable Audit Trail)
create table if not exists public.review_logs (
  id uuid not null primary key, -- Client-generated UUID for idempotency
  user_id uuid not null references auth.users(id) on delete cascade,
  word_id text not null,
  rating smallint not null,
  state smallint not null,
  due timestamptz not null,
  stability numeric(10, 4) not null,
  difficulty numeric(10, 4) not null,
  elapsed_days int not null,
  last_elapsed_days int not null,
  scheduled_days int not null,
  review_duration_ms int not null default 0,
  reviewed_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists idx_review_logs_user_reviewed on public.review_logs (user_id, reviewed_at);

alter table public.review_logs enable row level security;

create policy "Users can view their own review logs."
  on public.review_logs for select
  using (auth.uid() = user_id);

create policy "Users can insert their own review logs."
  on public.review_logs for insert
  with check (auth.uid() = user_id);

-- 4. User Settings
create table if not exists public.user_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value text not null,
  updated_at timestamptz not null default timezone('utc'::text, now()),
  primary key (user_id, key)
);

alter table public.user_settings enable row level security;

create policy "Users can manage their own settings."
  on public.user_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 5. Sync Devices
create table if not exists public.sync_devices (
  id uuid not null primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_name text not null,
  last_seen_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.sync_devices enable row level security;

create policy "Users can manage their sync devices."
  on public.sync_devices for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
