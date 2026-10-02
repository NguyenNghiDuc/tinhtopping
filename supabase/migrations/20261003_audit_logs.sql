create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  action text not null,
  entity text not null,
  entity_id text,
  sales_date date,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_sales_date_idx on public.audit_logs (sales_date desc);
create index if not exists audit_logs_user_id_idx on public.audit_logs (user_id);

alter table public.audit_logs enable row level security;

drop policy if exists "authenticated can insert audit logs" on public.audit_logs;
create policy "authenticated can insert audit logs"
on public.audit_logs
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "managers can read audit logs" on public.audit_logs;
create policy "managers can read audit logs"
on public.audit_logs
for select
to authenticated
using (
  exists (
    select 1
    from public.user_profiles profile
    where profile.user_id = auth.uid()
      and profile.role = 'manager'
  )
);
