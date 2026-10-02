-- Additional convenience/reporting features. Safe: does not drop sales or employee data.

create table if not exists public.app_settings (
  id boolean primary key default true check (id = true),
  topping_price integer not null default 1000 check (topping_price > 0),
  anomaly_threshold integer not null default 100 check (anomaly_threshold > 0),
  updated_by uuid default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id, topping_price, anomaly_threshold)
values (true, 1000, 100)
on conflict (id) do nothing;

create table if not exists public.day_notes (
  sales_date date primary key,
  note text not null default '',
  updated_by uuid default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;
alter table public.day_notes enable row level security;

drop policy if exists "authenticated read settings" on public.app_settings;
create policy "authenticated read settings" on public.app_settings
for select to authenticated using (true);

drop policy if exists "managers manage settings" on public.app_settings;
create policy "managers manage settings" on public.app_settings
for all to authenticated
using (public.current_app_role() = 'manager')
with check (public.current_app_role() = 'manager');

drop policy if exists "authenticated read day notes" on public.day_notes;
create policy "authenticated read day notes" on public.day_notes
for select to authenticated using (true);

drop policy if exists "authenticated manage day notes" on public.day_notes;
create policy "authenticated manage day notes" on public.day_notes
for all to authenticated
using (true)
with check (true);

-- Allow managers to change the topping price from the web settings page.
drop policy if exists "managers update topping types" on public.topping_types;
create policy "managers update topping types" on public.topping_types
for update to authenticated
using (public.current_app_role() = 'manager')
with check (public.current_app_role() = 'manager');

grant select on public.app_settings to authenticated;
grant select, insert, update on public.day_notes to authenticated;
grant update on public.topping_types to authenticated;

-- Manager-only audit reader that can resolve the actor's email.
create or replace function public.get_audit_log_details(p_limit integer default 100)
returns table (
  id bigint,
  table_name text,
  action text,
  record_id text,
  changed_by uuid,
  actor_email text,
  old_data jsonb,
  new_data jsonb,
  changed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_app_role() <> 'manager' then
    raise exception 'Manager permission required';
  end if;

  return query
  select a.id, a.table_name, a.action, a.record_id, a.changed_by,
         u.email::text as actor_email, a.old_data, a.new_data, a.changed_at
  from public.audit_logs a
  left join auth.users u on u.id = a.changed_by
  order by a.changed_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

grant execute on function public.get_audit_log_details(integer) to authenticated;
