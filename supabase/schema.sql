-- ─── Super Terminal: Supabase schema ────────────────────────────
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

-- RLS 활성화 (anon key 사용 시 보안 필수)
alter table public.users enable row level security;

-- 서버(service_role)만 접근 허용 — 클라이언트 직접 접근 차단
-- anon / authenticated 역할에 대한 정책은 의도적으로 추가하지 않음
