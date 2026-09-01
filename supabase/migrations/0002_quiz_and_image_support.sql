-- Migration: 0002_quiz_and_image_support.sql
-- Purpose: Support Quizzes Table and Word Progress Quiz Stats for TOEIC Vocabulary PWA

-- 1. Quizzes Table (6-Question Matrix per Word)
create table if not exists public.quizzes (
  id text not null primary key,
  word_id text not null,
  type text not null, -- 'multiple_choice' | 'cloze_fill'
  sub_type text,      -- 'vocab_choice', 'grammar_form', 'synonym_context', 'collocation_cloze', 'active_recall', 'sentence_complete'
  stem text not null,
  options jsonb not null default '[]'::jsonb,
  answer text not null,
  cloze_hint text,
  explanation text not null,
  frequency_tier text not null default 'core_1200',
  created_at timestamptz not null default timezone('utc'::text, now())
);

-- Indexes for lightning-fast quiz retrieval
create index if not exists idx_quizzes_word_id on public.quizzes (word_id);
create index if not exists idx_quizzes_tier_type on public.quizzes (frequency_tier, type);

-- Row Level Security (RLS)
alter table public.quizzes enable row level security;

-- Quizzes are public curriculum content; anyone authenticated or anon can read
create policy "Anyone can read quizzes."
  on public.quizzes for select
  using (true);

-- Only service role / admin can insert or modify quizzes
create policy "Service role can manage quizzes."
  on public.quizzes for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- 2. Extend User Word Progress with Quiz Performance Metrics
alter table public.user_word_progress
  add column if not exists quiz_correct_count int not null default 0,
  add column if not exists quiz_total_count int not null default 0,
  add column if not exists last_quiz_at timestamptz;
