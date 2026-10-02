create table if not exists public.closed_days (
  sales_date date primary key,
  closed_by uuid not null default auth.uid() references auth.users(id),
  closed_at timestamptz not null default now()
);

create table if not exists public.login_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  user_email text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists login_logs_created_at_idx on public.login_logs(created_at desc);
create index if not exists login_logs_user_id_idx on public.login_logs(user_id);

alter table public.closed_days enable row level security;
alter table public.login_logs enable row level security;

drop policy if exists "authenticated read closed days" on public.closed_days;
create policy "authenticated read closed days" on public.closed_days
for select to authenticated using (true);

drop policy if exists "managers manage closed days" on public.closed_days;
create policy "managers manage closed days" on public.closed_days
for all to authenticated
using (public.current_app_role() = 'manager')
with check (public.current_app_role() = 'manager');

drop policy if exists "users insert own login logs" on public.login_logs;
create policy "users insert own login logs" on public.login_logs
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "managers read login logs" on public.login_logs;
create policy "managers read login logs" on public.login_logs
for select to authenticated
using (public.current_app_role() = 'manager');

create or replace function public.is_day_closed(p_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(select 1 from public.closed_days where sales_date = p_date)
$$;

-- Rebuild shift write policies so staff cannot change a closed day.
drop policy if exists "authenticated users insert shifts" on public.shifts;
create policy "authenticated users insert shifts" on public.shifts for insert to authenticated
with check (
  created_by = auth.uid()
  and (public.current_app_role() = 'manager' or not public.is_day_closed(sales_date))
);

drop policy if exists "staff update own shifts and managers update all" on public.shifts;
create policy "staff update own shifts and managers update all" on public.shifts for update to authenticated
using (
  public.current_app_role() = 'manager'
  or (created_by = auth.uid() and not public.is_day_closed(sales_date))
)
with check (
  public.current_app_role() = 'manager'
  or (created_by = auth.uid() and not public.is_day_closed(sales_date))
);

drop policy if exists "staff delete own shifts and managers delete all" on public.shifts;
create policy "staff delete own shifts and managers delete all" on public.shifts for delete to authenticated
using (
  public.current_app_role() = 'manager'
  or (created_by = auth.uid() and not public.is_day_closed(sales_date))
);
