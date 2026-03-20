-- ─── X-Launchpad: Supabase schema ────────────────────────────
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.

create table if not exists public.users (
  id            bigserial       primary key,
  email         text            unique not null,
  password_hash text            not null,
  name          text            not null default '',
  created_at    timestamptz     not null default now(),
  updated_at    timestamptz     not null default now()
);

-- updated_at 자동 갱신 함수
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- updated_at 트리거
drop trigger if exists users_updated_at on public.users;
create trigger users_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- 서버에서 anon key 사용 시 RLS가 모든 쿼리를 차단하므로 비활성화
-- (이 앱은 서버 전용으로 Supabase에 접근하며, 클라이언트가 직접 접근하지 않음)
alter table public.users disable row level security;

-- ─── Plans ──────────────────────────────────────────────────────
create table if not exists public.plans (
  id            text            primary key,
  user_id       bigint          not null references public.users(id) on delete cascade,
  title         text            not null default '',
  content       text            not null default '',
  category      text            not null default 'other',
  created_at    timestamptz     not null default now(),
  updated_at    timestamptz     not null default now()
);

create index if not exists idx_plans_user_id on public.plans(user_id);

-- updated_at 트리거
drop trigger if exists plans_updated_at on public.plans;
create trigger plans_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

alter table public.plans disable row level security;

-- plans 테이블 확장
alter table public.plans add column if not exists status text not null default 'todo';
alter table public.plans add column if not exists ai_done boolean not null default false;

-- ─── Plan Logs ──────────────────────────────────────────────────
create table if not exists public.plan_logs (
  id          bigserial       primary key,
  plan_id     text            not null references public.plans(id) on delete cascade,
  type        text            not null,
  content     text            not null default '',
  commit_hash text,
  created_at  timestamptz     not null default now()
);

create index if not exists idx_plan_logs_plan_id on public.plan_logs(plan_id);

alter table public.plan_logs disable row level security;

ALTER TABLE plans ADD COLUMN use_worktree
  boolean DEFAULT false;

ALTER TABLE plans ADD COLUMN IF NOT EXISTS use_headless
  boolean DEFAULT false;

ALTER TABLE plans ADD COLUMN IF NOT EXISTS ai_sessions
  jsonb DEFAULT '[]'::jsonb;

ALTER TABLE plans ADD COLUMN IF NOT EXISTS ticket_id
  text UNIQUE;

