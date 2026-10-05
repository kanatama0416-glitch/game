-- にゃちまる商店: tables in the 家計簿 (kakeibo) Supabase project, so both apps share one login.
-- Additive only: no existing 家計簿 table, function or policy is changed.
-- Access rule for every table: logged in AND own row AND email on private.nyachimaru_allowed_users.

-- Allowlist (not granted to any API role, so it cannot be read or changed from the browser)
create table private.nyachimaru_allowed_users (
  email text primary key check (email = lower(email)),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
revoke all on private.nyachimaru_allowed_users from public, anon, authenticated;
insert into private.nyachimaru_allowed_users (email) values ('kanatama0416@gmail.com');

create or replace function private.nyachimaru_is_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.nyachimaru_allowed_users a
    where a.active and a.email = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  );
$$;
revoke all on function private.nyachimaru_is_allowed() from public, anon;
grant execute on function private.nyachimaru_is_allowed() to authenticated;

-- Used by the entrance screen to tell the user whether they may come in.
create or replace function public.nyachimaru_check_access()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.nyachimaru_is_allowed(); $$;
revoke all on function public.nyachimaru_check_access() from public, anon;
grant execute on function public.nyachimaru_check_access() to authenticated;

create table public.nyachimaru_shops (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  name text not null default '' check (char_length(name) <= 20),
  start_date date,
  updated_at timestamptz not null default now()
);
create table public.nyachimaru_records (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  event_key text not null check (event_key ~ '^[a-z0-9_]{1,40}$'),
  date date not null,
  amount bigint check (amount is null or amount >= 0),
  memo text check (memo is null or char_length(memo) <= 80),
  updated_at timestamptz not null default now(),
  primary key (user_id, event_key)
);
create table public.nyachimaru_months (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  sales bigint not null default 0 check (sales >= 0),
  expenses bigint not null default 0 check (expenses >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, month)
);
create table public.nyachimaru_skips (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  event_key text not null check (event_key ~ '^[a-z0-9_]{1,40}$'),
  primary key (user_id, event_key)
);

alter table public.nyachimaru_shops   enable row level security;
alter table public.nyachimaru_records enable row level security;
alter table public.nyachimaru_months  enable row level security;
alter table public.nyachimaru_skips   enable row level security;

revoke all on public.nyachimaru_shops, public.nyachimaru_records, public.nyachimaru_months, public.nyachimaru_skips from anon;
grant select, insert, update, delete on public.nyachimaru_shops, public.nyachimaru_records, public.nyachimaru_months, public.nyachimaru_skips to authenticated;

create policy "nyachimaru owner select" on public.nyachimaru_shops for select to authenticated
  using ((select auth.uid()) = user_id and (select private.nyachimaru_is_allowed()));
create policy "nyachimaru owner insert" on public.nyachimaru_shops for insert to authenticated
  with check ((select auth.uid()) = user_id and (select private.nyachimaru_is_allowed()));
create policy "nyachimaru owner update" on public.nyachimaru_shops for update to authenticated
  using ((select auth.uid()) = user_id and (select private.nyachimaru_is_allowed()))
  with check ((select auth.uid()) = user_id and (select private.nyachimaru_is_allowed()));
create policy "nyachimaru owner delete" on public.nyachimaru_shops for delete to authenticated
  using ((select auth.uid()) = user_id and (select private.nyachimaru_is_allowed()));

create policy "nyachimaru owner select" on public.nyachimaru_records for select to authenticated
  using ((select auth.uid()) = user_id and (select private.nyachimaru_is_allowed()));
create policy "nyachimaru owner insert" on public.nyachimaru_records for insert to authenticated
  with check ((select auth.uid()) = user_id and (select private.nyachimaru_is_allowed()));
create policy "nyachimaru owner update" on public.nyachimaru_records for update to authenticated
  using ((select auth.uid()) = user_id and (select private.nyachimaru_is_allowed()))
  with check ((select auth.uid()) = user_id and (select private.nyachimaru_is_allowed()));
create policy "nyachimaru owner delete" on public.nyachimaru_records for delete to authenticated
  using ((select auth.uid()) = user_id and (select private.nyachimaru_is_allowed()));

create policy "nyachimaru owner select" on public.nyachimaru_months for select to authenticated
  using ((select auth.uid()) = user_id and (select private.nyachimaru_is_allowed()));
create policy "nyachimaru owner insert" on public.nyachimaru_months for insert to authenticated
  with check ((select auth.uid()) = user_id and (select private.nyachimaru_is_allowed()));
create policy "nyachimaru owner update" on public.nyachimaru_months for update to authenticated
  using ((select auth.uid()) = user_id and (select private.nyachimaru_is_allowed()))
  with check ((select auth.uid()) = user_id and (select private.nyachimaru_is_allowed()));
create policy "nyachimaru owner delete" on public.nyachimaru_months for delete to authenticated
  using ((select auth.uid()) = user_id and (select private.nyachimaru_is_allowed()));

create policy "nyachimaru owner select" on public.nyachimaru_skips for select to authenticated
  using ((select auth.uid()) = user_id and (select private.nyachimaru_is_allowed()));
create policy "nyachimaru owner insert" on public.nyachimaru_skips for insert to authenticated
  with check ((select auth.uid()) = user_id and (select private.nyachimaru_is_allowed()));
create policy "nyachimaru owner delete" on public.nyachimaru_skips for delete to authenticated
  using ((select auth.uid()) = user_id and (select private.nyachimaru_is_allowed()));
