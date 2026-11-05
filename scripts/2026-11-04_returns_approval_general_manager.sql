-- ============================================================
-- Returns approval chain + General Manager role
-- Applied 2026-11-04
--
-- 1. returns_log: the live table still had the legacy shape
--    (menu_item_name / unit_price / reason / requested_by) while
--    the app writes item_name / item_total / return_reason /
--    requested_at / resolved_at / reviewed. Every insert failed
--    with 42703, so returns never reached the bar or a manager.
-- 2. returns_log is outlet-scoped via RLS, but the app never sets
--    outlet_id. New rows get it from the caller's profile.
-- 3. New role 'general_manager' with owner-level access.
-- ============================================================

begin;

-- ── 1. returns_log: add the columns the app uses ─────────────
alter table returns_log
  add column if not exists order_id uuid references orders(id) on delete cascade,
  add column if not exists item_name text,
  add column if not exists item_total numeric(12, 2),
  add column if not exists table_name text,
  add column if not exists waitron_id uuid references profiles(id),
  add column if not exists waitron_name text,
  add column if not exists return_reason text,
  add column if not exists requested_at timestamptz default now(),
  add column if not exists resolved_at timestamptz,
  add column if not exists reviewed boolean default false,
  add column if not exists reviewed_by_name text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists shift_date date,
  add column if not exists kitchen_name text,
  add column if not exists griller_name text,
  add column if not exists notes text;

-- Backfill any legacy rows from the old column names
update returns_log
   set item_name     = coalesce(item_name, menu_item_name),
       item_total    = coalesce(item_total, quantity * unit_price),
       return_reason = coalesce(return_reason, reason),
       waitron_id    = coalesce(waitron_id, requested_by),
       requested_at  = coalesce(requested_at, created_at),
       shift_date    = coalesce(shift_date, (created_at at time zone 'Africa/Lagos')::date)
 where item_name is null
    or item_total is null
    or return_reason is null
    or waitron_id is null
    or requested_at is null
    or shift_date is null;

-- Legacy NOT NULL columns are superseded by item_name / item_total
alter table returns_log alter column menu_item_name drop not null;
alter table returns_log alter column unit_price drop not null;

-- ── 2. Fill outlet_id (and defaults) for rows inserted by the app ──
create or replace function set_returns_log_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.outlet_id is null then
    new.outlet_id := coalesce(
      (select outlet_id from profiles where id = auth.uid()),
      (select id from outlets order by created_at limit 1)
    );
  end if;
  if new.requested_at is null then
    new.requested_at := now();
  end if;
  if new.shift_date is null then
    new.shift_date := (new.requested_at at time zone 'Africa/Lagos')::date;
  end if;
  return new;
end;
$$;

drop trigger if exists set_returns_log_defaults_bi on returns_log;
create trigger set_returns_log_defaults_bi
  before insert on returns_log
  for each row execute function set_returns_log_defaults();

-- Allow inserts that leave outlet_id unset (single-outlet clients)
drop policy if exists rl_insert on returns_log;
create policy rl_insert on returns_log
  for insert to authenticated
  with check (outlet_id is null or user_can_access_outlet(outlet_id));

-- Clear return flags left over from inserts that failed before this fix
update order_items oi
   set return_requested = false,
       return_requested_at = null,
       return_reason = null
 where oi.return_requested
   and not exists (
     select 1 from returns_log rl
      where rl.order_item_id = oi.id
        and rl.status in ('pending', 'bar_accepted', 'kitchen_accepted', 'griller_accepted')
   );

-- ── 3. General Manager = owner-level access ──────────────────
create or replace function user_can_access_outlet(target_outlet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is null
      or get_user_role() in ('owner', 'general_manager', 'executive')
      or get_user_outlet_id() = target_outlet_id;
$$;

-- Owner role assignment: general managers count as owners
create or replace function prevent_owner_role_escalation()
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

-- Nobody can move themselves (or anyone else) into a privileged role
-- unless they already hold one.
create or replace function prevent_privileged_role_change()
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

drop trigger if exists prevent_privileged_role_change_bu on profiles;
create trigger prevent_privileged_role_change_bu
  before update on profiles
  for each row execute function prevent_privileged_role_change();

create or replace function prevent_privileged_role_change_insert()
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

drop trigger if exists prevent_privileged_role_insert on profiles;
create trigger prevent_privileged_role_insert
  before insert on profiles
  for each row execute function prevent_privileged_role_change_insert();

-- ── 4. Policies that must treat general_manager like owner ────
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select
  using (get_user_role() in ('owner', 'general_manager', 'executive')
         or outlet_id = get_user_outlet_id()
         or id = auth.uid());

drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles for update
  using (get_user_role() in ('owner', 'general_manager', 'executive')
         or outlet_id = get_user_outlet_id()
         or id = auth.uid());

drop policy if exists profiles_delete on profiles;
create policy profiles_delete on profiles for delete
  using (get_user_role() in ('owner', 'general_manager', 'executive')
         or outlet_id = get_user_outlet_id());

drop policy if exists "manager write benchmarks" on kitchen_stock_benchmarks;
create policy "manager write benchmarks" on kitchen_stock_benchmarks for all
  using (exists (
    select 1 from profiles
     where profiles.id = auth.uid()
       and profiles.role in ('owner', 'general_manager', 'manager')
  ));

drop policy if exists "Owner and executive can insert outlets" on outlets;
create policy "Owner and executive can insert outlets" on outlets for insert
  with check ((select role from profiles where id = auth.uid())
              in ('owner', 'general_manager', 'executive'));

drop policy if exists "Owner and executive can update outlets" on outlets;
create policy "Owner and executive can update outlets" on outlets for update
  using ((select role from profiles where id = auth.uid())
         in ('owner', 'general_manager', 'executive'));

-- ── 5. Payment recalculation must not re-bill returns ─────────
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
       and (void_qty is null or void_qty = 0)
       and coalesce(return_accepted, false) = false
       and lower(coalesce(status, '')) <> 'cancelled';
    if abs(real_total - new.total_amount) > 1 then
      new.total_amount := real_total;
    end if;
  end if;
  return new;
end;
$$;

commit;
