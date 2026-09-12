-- =============================================================================
-- 0014_textbook_knowledge.sql
-- T07：textbook_knowledge 表
--   同版本可复用的知识点沉淀；命中缓存则跳过联网检索省成本。
--   status='verified' 后全教师可读（含 anon）；pending 仅版本 owner 可读。
-- =============================================================================

create table if not exists public.textbook_knowledge (
  id                  uuid primary key default gen_random_uuid(),
  textbook_version_id  uuid not null references public.textbook_versions (id) on delete cascade,
  section             text not null,
  content             text not null,
  status              text not null default 'pending'
                        check (status in ('pending', 'verified')),
  verified_by         uuid references auth.users (id) on delete set null,
  source              text not null default 'ai'
                        check (source in ('ai', 'teacher', 'upload')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- 按版本 + 状态查询（命中缓存判断 / 公开知识下发）
create index if not exists textbook_knowledge_version_idx
  on public.textbook_knowledge (textbook_version_id, status);

comment on table public.textbook_knowledge is
  '教材版本沉淀的知识点；verified 后全教师可读（含 anon），作为生成时的教材上下文缓存';
