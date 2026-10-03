-- Modular feature suite: settings, trash, login/audit support.
-- Safe to run more than once.

alter table if exists public.app_settings
  add column if not exists store_name text not null default 'Sổ topping';

create table if not exists public.deleted_items (
  id bigserial primary key,
  entity_type text not null,
  entity_id text,
  payload jsonb not null default '{}'::jsonb,
  deleted_by uuid references auth.users(id),
  deleted_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create table if not exists public.login_logs (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  device_info text,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigserial primary key,
  user_id uuid references auth.users(id),
  user_email text,
  action text not null,
  entity text not null,
  entity_id text,
  sales_date date,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.deleted_items enable row level security;
alter table public.login_logs enable row level security;
alter table public.audit_logs enable row level security;

-- Helper expression is repeated so this migration does not depend on a custom role function.
drop policy if exists "manager read deleted items" on public.deleted_items;
create policy "manager read deleted items" on public.deleted_items for select to authenticated
using (exists (select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role='manager'));
drop policy if exists "authenticated insert deleted items" on public.deleted_items;
create policy "authenticated insert deleted items" on public.deleted_items for insert to authenticated
with check (deleted_by is null or deleted_by=auth.uid());
drop policy if exists "manager delete deleted items" on public.deleted_items;
create policy "manager delete deleted items" on public.deleted_items for delete to authenticated
using (exists (select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role='manager'));

drop policy if exists "users insert own login logs" on public.login_logs;
create policy "users insert own login logs" on public.login_logs for insert to authenticated with check (user_id=auth.uid());
drop policy if exists "users read own login logs" on public.login_logs;
create policy "users read own login logs" on public.login_logs for select to authenticated using (user_id=auth.uid());
drop policy if exists "managers read login logs" on public.login_logs;
create policy "managers read login logs" on public.login_logs for select to authenticated
using (exists (select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role='manager'));

drop policy if exists "authenticated insert audit" on public.audit_logs;
create policy "authenticated insert audit" on public.audit_logs for insert to authenticated
with check (user_id is null or user_id=auth.uid());
drop policy if exists "managers read audit" on public.audit_logs;
create policy "managers read audit" on public.audit_logs for select to authenticated
using (exists (select 1 from public.user_profiles p where p.user_id=auth.uid() and p.role='manager'));

grant select,insert,delete on public.deleted_items to authenticated;
grant select,insert on public.login_logs to authenticated;
grant select,insert on public.audit_logs to authenticated;
grant usage,select on sequence public.deleted_items_id_seq to authenticated;
grant usage,select on sequence public.login_logs_id_seq to authenticated;
grant usage,select on sequence public.audit_logs_id_seq to authenticated;

notify pgrst, 'reload schema';
