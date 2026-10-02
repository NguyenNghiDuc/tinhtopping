create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('manager', 'staff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 60),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists employees_name_ci_unique on public.employees (lower(trim(name)));
create index if not exists employees_active_name_idx on public.employees (active, name);

create table if not exists public.topping_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 1 and 80),
  unit_price integer not null default 1000 check (unit_price > 0),
  sort_order smallint not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.topping_types (name, unit_price, sort_order) values
  ('Topping', 1000, 0)
on conflict do nothing;

update public.topping_types set unit_price = 1000 where unit_price <> 1000;

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  sales_date date not null,
  shift text not null check (shift in ('morning', 'afternoon', 'evening')),
  employee_id uuid not null references public.employees(id) on delete restrict,
  note text not null default '',
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shifts drop constraint if exists shifts_one_per_day;

create index if not exists shifts_date_idx on public.shifts (sales_date desc);
create index if not exists shifts_employee_date_idx on public.shifts (employee_id, sales_date desc);

create table if not exists public.shift_toppings (
  shift_id uuid not null references public.shifts(id) on delete cascade,
  topping_type_id uuid not null references public.topping_types(id) on delete restrict,
  quantity integer not null check (quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (shift_id, topping_type_id)
);

create index if not exists shift_toppings_type_idx on public.shift_toppings (topping_type_id, shift_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.user_profiles where user_id = (select auth.uid())
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (user_id, role) values (new.id, 'staff') on conflict (user_id) do nothing;
  return new;
end;
$$;

create or replace function public.require_active_shift_employee()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.employee_id = old.employee_id then
    return new;
  end if;
  if not exists (select 1 from public.employees where id = new.employee_id and active) then
    raise exception 'Selected employee is inactive or unavailable';
  end if;
  return new;
end;
$$;

create or replace function public.save_shift(
  p_shift_id uuid,
  p_sales_date date,
  p_shift text,
  p_employee_id uuid,
  p_note text,
  p_toppings jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  saved_shift_id uuid;
  topping_item jsonb;
  topping_id uuid;
  topping_quantity integer;
begin
  if jsonb_typeof(p_toppings) <> 'array' then
    raise exception 'Topping details must be a JSON array';
  end if;

  if p_shift_id is null then
    insert into public.shifts (sales_date, shift, employee_id, note, created_by)
    values (p_sales_date, p_shift, p_employee_id, coalesce(p_note, ''), (select auth.uid()))
    returning id into saved_shift_id;
  else
    update public.shifts
    set sales_date = p_sales_date,
        shift = p_shift,
        employee_id = p_employee_id,
        note = coalesce(p_note, '')
    where id = p_shift_id
    returning id into saved_shift_id;
    if saved_shift_id is null then
      raise exception 'Shift not found or not permitted';
    end if;
  end if;

  delete from public.shift_toppings where shift_id = saved_shift_id;

  for topping_item in select value from jsonb_array_elements(p_toppings)
  loop
    topping_id := (topping_item ->> 'topping_type_id')::uuid;
    topping_quantity := (topping_item ->> 'quantity')::integer;
    if topping_quantity < 0 then
      raise exception 'Topping quantity cannot be negative';
    end if;
    if not exists (select 1 from public.topping_types where id = topping_id and active) then
      raise exception 'Topping type is inactive or unavailable';
    end if;
    if topping_quantity > 0 then
      insert into public.shift_toppings (shift_id, topping_type_id, quantity)
      values (saved_shift_id, topping_id, topping_quantity);
    end if;
  end loop;

  return saved_shift_id;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users for each row execute function public.handle_new_auth_user();

drop trigger if exists user_profiles_set_updated_at on public.user_profiles;
create trigger user_profiles_set_updated_at before update on public.user_profiles for each row execute function public.set_updated_at();
drop trigger if exists employees_set_updated_at on public.employees;
create trigger employees_set_updated_at before update on public.employees for each row execute function public.set_updated_at();
drop trigger if exists topping_types_set_updated_at on public.topping_types;
create trigger topping_types_set_updated_at before update on public.topping_types for each row execute function public.set_updated_at();
drop trigger if exists shifts_set_updated_at on public.shifts;
create trigger shifts_set_updated_at before update on public.shifts for each row execute function public.set_updated_at();
drop trigger if exists shift_toppings_set_updated_at on public.shift_toppings;
create trigger shift_toppings_set_updated_at before update on public.shift_toppings for each row execute function public.set_updated_at();
drop trigger if exists shifts_require_active_employee on public.shifts;
create trigger shifts_require_active_employee before insert or update of employee_id on public.shifts for each row execute function public.require_active_shift_employee();

alter table public.user_profiles enable row level security;
alter table public.employees enable row level security;
alter table public.topping_types enable row level security;
alter table public.shifts enable row level security;
alter table public.shift_toppings enable row level security;

drop policy if exists "read own profile or manager profiles" on public.user_profiles;
create policy "read own profile or manager profiles" on public.user_profiles for select to authenticated
  using (user_id = (select auth.uid()) or public.current_app_role() = 'manager');
drop policy if exists "managers manage profiles" on public.user_profiles;
create policy "managers manage profiles" on public.user_profiles for all to authenticated
  using (public.current_app_role() = 'manager') with check (public.current_app_role() = 'manager');

drop policy if exists "authenticated users read employees" on public.employees;
create policy "authenticated users read employees" on public.employees for select to authenticated using (true);
drop policy if exists "managers insert employees" on public.employees;
create policy "managers insert employees" on public.employees for insert to authenticated
  with check (public.current_app_role() = 'manager');
drop policy if exists "managers update employees" on public.employees;
create policy "managers update employees" on public.employees for update to authenticated
  using (public.current_app_role() = 'manager') with check (public.current_app_role() = 'manager');
drop policy if exists "managers delete employees" on public.employees;
create policy "managers delete employees" on public.employees for delete to authenticated
  using (public.current_app_role() = 'manager');

drop policy if exists "authenticated users read topping types" on public.topping_types;
create policy "authenticated users read topping types" on public.topping_types for select to authenticated using (active);

drop policy if exists "authenticated users read shifts" on public.shifts;
create policy "authenticated users read shifts" on public.shifts for select to authenticated using (true);
drop policy if exists "authenticated users insert shifts" on public.shifts;
create policy "authenticated users insert shifts" on public.shifts for insert to authenticated
  with check (created_by = (select auth.uid()));
drop policy if exists "staff update own shifts and managers update all" on public.shifts;
create policy "staff update own shifts and managers update all" on public.shifts for update to authenticated
  using (created_by = (select auth.uid()) or public.current_app_role() = 'manager')
  with check (created_by = (select auth.uid()) or public.current_app_role() = 'manager');
drop policy if exists "staff delete own shifts and managers delete all" on public.shifts;
create policy "staff delete own shifts and managers delete all" on public.shifts for delete to authenticated
  using (created_by = (select auth.uid()) or public.current_app_role() = 'manager');

drop policy if exists "authenticated users read shift toppings" on public.shift_toppings;
create policy "authenticated users read shift toppings" on public.shift_toppings for select to authenticated
  using (exists (select 1 from public.shifts where id = shift_id));
drop policy if exists "owners and managers manage shift toppings" on public.shift_toppings;
create policy "owners and managers manage shift toppings" on public.shift_toppings for all to authenticated
  using (exists (
    select 1 from public.shifts
    where id = shift_id and (created_by = (select auth.uid()) or public.current_app_role() = 'manager')
  ))
  with check (exists (
    select 1 from public.shifts
    where id = shift_id and (created_by = (select auth.uid()) or public.current_app_role() = 'manager')
  ));

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.user_profiles, public.employees, public.shifts, public.shift_toppings to authenticated;
grant select on public.topping_types to authenticated;
revoke execute on function public.save_shift(uuid, date, text, uuid, text, jsonb) from public, anon;
grant execute on function public.save_shift(uuid, date, text, uuid, text, jsonb) to authenticated;

do $$
begin
  if to_regclass('public.sales_records') is not null then
    execute $migration$
      insert into public.shifts (id, sales_date, shift, employee_id, note, created_by, created_at, updated_at)
      select id, sales_date, shift, employee_id, note, created_by, created_at, updated_at
      from public.sales_records
      on conflict (id) do nothing
    $migration$;

    execute $migration$
      insert into public.shift_toppings (shift_id, topping_type_id, quantity)
      select shift_row.id, topping.id, coalesce(sales.quantities[topping.sort_order + 1], 0)
      from public.sales_records as sales
      join public.shifts as shift_row on shift_row.id = sales.id
      cross join public.topping_types as topping
      where coalesce(sales.quantities[topping.sort_order + 1], 0) > 0
      on conflict (shift_id, topping_type_id) do nothing
    $migration$;
  end if;
end;
$$;