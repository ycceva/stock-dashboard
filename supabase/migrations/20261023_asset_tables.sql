-- 우리집 자산관리: 월별 기록과 AI 점검
-- 메모는 기존 study_notes 테이블에 id 'assetnote'로 저장한다.

create table if not exists public.asset_months (
  month           text primary key,               -- 'YYYY-MM'
  income          bigint not null default 0,      -- 이달 입금 (기록용)
  expense         bigint not null default 0,      -- 이달 지출 (기록용)
  real_estate     bigint not null default 0,      -- 부동산 시세
  my_accounts     jsonb  not null default '[]',   -- [{name, amount}]
  spouse_accounts jsonb  not null default '[]',   -- [{name, amount}]
  updated_at      timestamptz not null default now()
);

create table if not exists public.asset_reviews (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  base_month  text,
  content     text not null
);

alter table public.asset_months  enable row level security;
alter table public.asset_reviews enable row level security;

create policy "owner only" on public.asset_months for all to authenticated
  using ((auth.jwt() ->> 'email') = 'evadslr@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'evadslr@gmail.com');

create policy "owner only" on public.asset_reviews for all to authenticated
  using ((auth.jwt() ->> 'email') = 'evadslr@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'evadslr@gmail.com');
