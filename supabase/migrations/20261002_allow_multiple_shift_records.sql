do $$
declare
  unique_constraint record;
begin
  for unique_constraint in
    select constraint_row.conname
    from pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.shifts'::regclass
      and constraint_row.contype = 'u'
      and (
        array(
          select attribute.attname::text
          from unnest(constraint_row.conkey) as constraint_column(attnum)
          join pg_attribute as attribute
            on attribute.attrelid = constraint_row.conrelid
            and attribute.attnum = constraint_column.attnum
          order by attribute.attname::text
        ) = array['sales_date', 'shift']::text[]
        or array(
          select attribute.attname::text
          from unnest(constraint_row.conkey) as constraint_column(attnum)
          join pg_attribute as attribute
            on attribute.attrelid = constraint_row.conrelid
            and attribute.attnum = constraint_column.attnum
          order by attribute.attname::text
        ) = array['employee_id', 'sales_date', 'shift']::text[]
      )
  loop
    execute format('alter table public.shifts drop constraint %I', unique_constraint.conname);
  end loop;
end;
$$;