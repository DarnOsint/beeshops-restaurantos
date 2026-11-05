-- ============================================================
-- Production (qdibeyhdrcrddckouqmc) — General Manager role
--                                            2026-11-05
--
-- This project does not use outlets or the legacy returns_log
-- columns, so it needs a smaller migration than the staging
-- database. Applied directly via psql.
-- ============================================================

begin;

-- ── 1. returns_log: columns written by kitchen / grill KDS ────
alter table returns_log
  add column if not exists kitchen_name text,
  add column if not exists griller_name text;

-- ── 2. Payment recalculation must not re-bill returns ─────────
create or replace function public.recalculate_order_total()
returns trigger
language plpgsql
as $$
declare
  real_total numeric;
begin
  if new.status = 'paid' and (old.status is distinct from 'paid') then
    select coalesce(sum(total_price), 0) into real_total
      from order_items
     where order_id = new.id
       and (status is null or status not in ('voided', 'cancelled'))
       and coalesce(return_accepted, false) = false;
    if abs(real_total - new.total_amount) > 1 then
      new.total_amount := real_total;
    end if;
  end if;
  return new;
end;
$$;

-- ── 3. Owner assignment: general managers count as owners ─────
create or replace function public.prevent_owner_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
begin
  if new.role <> 'owner' then
    return new;
  end if;

  select role into caller_role from profiles where id = auth.uid() limit 1;

  -- auth.uid() is null for the service role / SQL editor
  if auth.uid() is not null
     and coalesce(caller_role, '') not in ('owner', 'general_manager') then
    raise exception 'Only owners can assign the owner role';
  end if;

  return new;
end;
$$;

-- ── 4. Nobody can self-escalate into a privileged role ────────
create or replace function public.prevent_privileged_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
begin
  if new.role = old.role then
    return new;
  end if;
  if new.role not in ('owner', 'general_manager', 'executive') then
    return new;
  end if;
  if auth.uid() is null then
    return new;
  end if;

  select role into caller_role from profiles where id = auth.uid() limit 1;

  if coalesce(caller_role, '') not in ('owner', 'general_manager', 'executive') then
    raise exception 'Only owners and general managers can assign the % role', new.role;
  end if;

  return new;
end;
$$;

create or replace function public.prevent_privileged_role_change_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
begin
  if new.role not in ('owner', 'general_manager', 'executive') then
    return new;
  end if;
  if auth.uid() is null then
    return new;
  end if;

  select role into caller_role from profiles where id = auth.uid() limit 1;

  if coalesce(caller_role, '') not in ('owner', 'general_manager', 'executive') then
    raise exception 'Only owners and general managers can assign the % role', new.role;
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_privileged_role_change_bu on profiles;
create trigger prevent_privileged_role_change_bu
  before update on profiles
  for each row execute function prevent_privileged_role_change();

drop trigger if exists prevent_privileged_role_insert on profiles;
create trigger prevent_privileged_role_insert
  before insert on profiles
  for each row execute function prevent_privileged_role_change_insert();

-- ── 5. Policies that list owner/manager explicitly ────────────
drop policy if exists "manager write kitchen_stock" on kitchen_stock;
create policy "manager write kitchen_stock" on kitchen_stock for all
  using (exists (
    select 1 from profiles
     where profiles.id = auth.uid()
       and profiles.role in ('owner', 'general_manager', 'manager', 'kitchen')
  ));

drop policy if exists "manager write benchmarks" on kitchen_stock_benchmarks;
create policy "manager write benchmarks" on kitchen_stock_benchmarks for all
  using (exists (
    select 1 from profiles
     where profiles.id = auth.uid()
       and profiles.role in ('owner', 'general_manager', 'manager')
  ));

commit;
