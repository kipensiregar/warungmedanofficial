-- Warung Medan CT Catering — initial schema (no recipe module).

-- Run ONLY once in the NEW Supabase project before real operational use.

-- No recipe tables are included. Ingredient usage is NOT automatically deducted by sales.

begin;

create extension if not exists pgcrypto;

create type public.app_role as enum ('owner', 'cashier', 'tenant', 'kitchen');

create type public.unit_kind as enum ('branch', 'bazaar');

create type public.sale_status as enum ('paid', 'voided');

create type public.payment_method as enum ('cash', 'bank_transfer', 'qris', 'debit', 'other');

create type public.movement_kind as enum ('opening', 'purchase', 'sale_usage', 'manual_in', 'manual_out', 'transfer_in', 'transfer_out', 'stocktake_adjustment', 'sale_reversal');

create table public.business_units (

  id uuid primary key default gen_random_uuid(),

  code text not null unique,

  name text not null,

  kind public.unit_kind not null,

  is_active boolean not null default true,

  created_at timestamptz not null default now()

);

create table public.user_profiles (

  user_id uuid primary key references auth.users(id) on delete cascade,

  display_name text,

  role public.app_role not null default 'cashier',

  unit_id uuid references public.business_units(id) on delete restrict,

  is_active boolean not null default true,

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now(),

  constraint profile_role_unit_check check (

    (role = 'owner' and unit_id is null) or

    (role <> 'owner' and unit_id is not null)

  )

);

create table public.ingredients (

  id uuid primary key default gen_random_uuid(),

  code text unique,

  name text not null,

  base_unit text not null,

  reorder_level numeric(14,3) not null default 0 check (reorder_level >= 0),

  is_active boolean not null default true,

  created_at timestamptz not null default now()

);

create table public.menu_items (

  id uuid primary key default gen_random_uuid(),

  sku text unique,

  name text not null,

  category text,

  sale_price numeric(14,2) not null default 0 check (sale_price >= 0),

  is_active boolean not null default true,

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now()

);

create table public.inventory_balances (

  unit_id uuid not null references public.business_units(id) on delete restrict,

  ingredient_id uuid not null references public.ingredients(id) on delete restrict,

  quantity numeric(14,4) not null default 0 check (quantity >= 0),

  average_unit_cost numeric(14,4) not null default 0 check (average_unit_cost >= 0),

  updated_at timestamptz not null default now(),

  primary key(unit_id, ingredient_id)

);

create table public.sales (

  id uuid primary key default gen_random_uuid(),

  client_request_id uuid not null unique,

  unit_id uuid not null references public.business_units(id) on delete restrict,

  cashier_user_id uuid not null references auth.users(id) on delete restrict,

  status public.sale_status not null default 'paid',

  subtotal numeric(14,2) not null check (subtotal >= 0),

  discount numeric(14,2) not null default 0 check (discount >= 0),

  total numeric(14,2) not null check (total >= 0),

  payment_method public.payment_method not null,

  paid_at timestamptz not null default now(),

  voided_at timestamptz,

  void_reason text,

  created_at timestamptz not null default now(),

  constraint sale_total_check check (total = greatest(0, subtotal - discount)),

  constraint sale_void_fields_check check (

    (status = 'paid' and voided_at is null and void_reason is null) or

    (status = 'voided' and voided_at is not null and nullif(trim(void_reason), '') is not null)

  )

);

create table public.sale_items (

  id uuid primary key default gen_random_uuid(),

  sale_id uuid not null references public.sales(id) on delete restrict,

  menu_item_id uuid not null references public.menu_items(id) on delete restrict,

  menu_name_snapshot text not null,

  quantity numeric(14,3) not null check (quantity > 0),

  unit_price numeric(14,2) not null check (unit_price >= 0),

  line_total numeric(14,2) not null check (line_total >= 0)

);

create table public.inventory_movements (

  id uuid primary key default gen_random_uuid(),

  unit_id uuid not null references public.business_units(id) on delete restrict,

  ingredient_id uuid not null references public.ingredients(id) on delete restrict,

  kind public.movement_kind not null,

  quantity_delta numeric(14,4) not null check (quantity_delta <> 0),

  unit_cost numeric(14,4) not null default 0 check (unit_cost >= 0),

  source_type text,

  source_id uuid,

  note text,

  created_by uuid references auth.users(id) on delete set null,

  created_at timestamptz not null default now()

);

create unique index inventory_movements_source_once

  on public.inventory_movements(unit_id, ingredient_id, kind, source_type, source_id)

  where source_id is not null;

create index inventory_movements_unit_date_idx

  on public.inventory_movements(unit_id, created_at desc);

create index sales_unit_date_idx

  on public.sales(unit_id, created_at desc);

create index sale_items_sale_id_idx on public.sale_items(sale_id);

create table public.expenses (

  id uuid primary key default gen_random_uuid(),

  unit_id uuid not null references public.business_units(id) on delete restrict,

  description text not null,

  category text not null,

  amount numeric(14,2) not null check (amount > 0),

  expense_date date not null default current_date,

  created_by uuid not null references auth.users(id) on delete restrict,

  created_at timestamptz not null default now()

);

create table public.cash_movements (

  id uuid primary key default gen_random_uuid(),

  unit_id uuid not null references public.business_units(id) on delete restrict,

  movement_type text not null check (movement_type in ('sale_income', 'sale_reversal', 'expense_out', 'manual_in', 'manual_out')),

  amount_delta numeric(14,2) not null check (amount_delta <> 0),

  payment_method public.payment_method,

  source_type text not null,

  source_id uuid not null,

  note text,

  created_by uuid references auth.users(id) on delete set null,

  created_at timestamptz not null default now(),

  unique (movement_type, source_type, source_id)

);

create index cash_movements_unit_date_idx on public.cash_movements(unit_id, created_at desc);

create table public.audit_logs (

  id bigint generated always as identity primary key,

  actor_user_id uuid references auth.users(id) on delete set null,

  unit_id uuid references public.business_units(id) on delete set null,

  action text not null,

  entity_type text not null,

  entity_id text,

  details jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()

);

-- RLS helper functions. Profiles cannot be self-created or self-promoted.

create or replace function public.current_app_role()

returns public.app_role

language sql stable security definer set search_path = ''

as $$

  select p.role

  from public.user_profiles p

  where p.user_id = (select auth.uid()) and p.is_active = true

  limit 1

$$;

create or replace function public.current_unit_id()

returns uuid

language sql stable security definer set search_path = ''

as $$

  select p.unit_id

  from public.user_profiles p

  where p.user_id = (select auth.uid()) and p.is_active = true

  limit 1

$$;

create or replace function public.is_active_user()

returns boolean

language sql stable security definer set search_path = ''

as $$

  select exists (

    select 1 from public.user_profiles p

    where p.user_id = (select auth.uid()) and p.is_active = true

  )

$$;

create or replace function public.can_access_unit(target_unit uuid)

returns boolean

language sql stable security definer set search_path = ''

as $$

  select public.current_app_role() = 'owner'

      or public.current_unit_id() = target_unit

$$;

-- Enable RLS on every table exposed through the Data API.

alter table public.business_units enable row level security;

alter table public.user_profiles enable row level security;

alter table public.ingredients enable row level security;

alter table public.menu_items enable row level security;

alter table public.inventory_balances enable row level security;

alter table public.sales enable row level security;

alter table public.sale_items enable row level security;

alter table public.inventory_movements enable row level security;

alter table public.expenses enable row level security;

alter table public.cash_movements enable row level security;

alter table public.audit_logs enable row level security;

create policy "active users read assigned units"

on public.business_units for select to authenticated

using (public.is_active_user() and (public.current_app_role() = 'owner' or id = public.current_unit_id()));

create policy "owner manages units"

on public.business_units for all to authenticated

using (public.current_app_role() = 'owner')

with check (public.current_app_role() = 'owner');

create policy "users read own profile or owner reads all"

on public.user_profiles for select to authenticated

using (user_id = (select auth.uid()) or public.current_app_role() = 'owner');

create policy "owner manages profiles"

on public.user_profiles for all to authenticated

using (public.current_app_role() = 'owner')

with check (public.current_app_role() = 'owner');

create policy "active users read ingredients"

on public.ingredients for select to authenticated

using (public.is_active_user());

create policy "owner manages ingredients"

on public.ingredients for all to authenticated

using (public.current_app_role() = 'owner')

with check (public.current_app_role() = 'owner');

create policy "active users read menu"

on public.menu_items for select to authenticated

using (public.is_active_user());

create policy "owner manages menu"

on public.menu_items for all to authenticated

using (public.current_app_role() = 'owner')

with check (public.current_app_role() = 'owner');

create policy "read inventory balances in assigned units"

on public.inventory_balances for select to authenticated

using (public.is_active_user() and public.can_access_unit(unit_id));

create policy "owner manages inventory balances"

on public.inventory_balances for all to authenticated

using (public.current_app_role() = 'owner')

with check (public.current_app_role() = 'owner');

create policy "read sales in assigned units"

on public.sales for select to authenticated

using (public.is_active_user() and public.can_access_unit(unit_id));

create policy "read sale items through parent sale"

on public.sale_items for select to authenticated

using (

  public.is_active_user() and exists (

    select 1 from public.sales s

    where s.id = sale_id and public.can_access_unit(s.unit_id)

  )

);

create policy "read inventory movements in assigned units"

on public.inventory_movements for select to authenticated

using (public.is_active_user() and public.can_access_unit(unit_id));

create policy "owner manages inventory movements"

on public.inventory_movements for all to authenticated

using (public.current_app_role() = 'owner')

with check (public.current_app_role() = 'owner');

create policy "read expenses in assigned units"

on public.expenses for select to authenticated

using (public.is_active_user() and public.can_access_unit(unit_id));

create policy "owner reads expenses"

on public.expenses for all to authenticated

using (public.current_app_role() = 'owner')

with check (public.current_app_role() = 'owner');

create policy "read cash movements in assigned units"

on public.cash_movements for select to authenticated

using (public.is_active_user() and public.can_access_unit(unit_id));

create policy "owner manages cash movements"

on public.cash_movements for all to authenticated

using (public.current_app_role() = 'owner')

with check (public.current_app_role() = 'owner');

create policy "owner reads audit logs"

on public.audit_logs for select to authenticated

using (public.current_app_role() = 'owner');

create policy "active users add audit logs for own unit"

on public.audit_logs for insert to authenticated

with check (

  public.is_active_user()

  and (public.current_app_role() = 'owner' or unit_id = public.current_unit_id())

  and actor_user_id = (select auth.uid())

);

-- Sales RPC: sale + line items + cash ledger are committed atomically.

-- Idempotency key client_request_id prevents double charging on retries.

create or replace function public.post_sale(

  p_client_request_id uuid,

  p_unit_id uuid,

  p_payment_method public.payment_method,

  p_items jsonb,

  p_discount numeric default 0

)

returns jsonb

language plpgsql

security definer

set search_path = ''

as $$

declare

  v_user uuid := auth.uid();

  v_role public.app_role;

  v_unit_kind public.unit_kind;

  v_sale_id uuid;

  v_existing_unit uuid;

  v_existing_user uuid;

  v_subtotal numeric(14,2);

  v_total numeric(14,2);

  v_item jsonb;

  v_menu_id uuid;

  v_qty numeric(14,3);

  v_price numeric(14,2);

  v_name text;

  v_line numeric(14,2);

begin

  if v_user is null then raise exception 'Authentication required'; end if;

  select p.role into v_role from public.user_profiles p

    where p.user_id = v_user and p.is_active = true;

  if v_role is null then raise exception 'Active user profile required'; end if;

  if v_role not in ('owner', 'cashier', 'tenant') then raise exception 'Role cannot post sales'; end if;

  if v_role <> 'owner' and public.current_unit_id() <> p_unit_id then raise exception 'Unit access denied'; end if;

  select u.kind into v_unit_kind from public.business_units u where u.id = p_unit_id and u.is_active = true;

  if v_unit_kind is null then raise exception 'Active business unit not found'; end if;

  if (v_role = 'tenant' and v_unit_kind <> 'bazaar') or (v_role = 'cashier' and v_unit_kind <> 'branch') then

    raise exception 'Role is not assigned to this unit type';

  end if;

  if p_client_request_id is null then raise exception 'client_request_id is required'; end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then

    raise exception 'At least one sale item is required';

  end if;

  if p_discount is null or p_discount < 0 then raise exception 'Discount must be zero or greater'; end if;

  select s.id, s.unit_id, s.cashier_user_id into v_sale_id, v_existing_unit, v_existing_user

  from public.sales s where s.client_request_id = p_client_request_id;

  if v_sale_id is not null then

    if v_existing_unit <> p_unit_id or (v_role <> 'owner' and v_existing_user <> v_user) then

      raise exception 'Idempotency key already used for another transaction';

    end if;

    return jsonb_build_object('sale_id', v_sale_id, 'status', 'existing');

  end if;

  v_subtotal := 0;

  for v_item in select value from jsonb_array_elements(p_items)

  loop

    v_menu_id := (v_item->>'menu_item_id')::uuid;

    v_qty := (v_item->>'quantity')::numeric;

    if v_qty is null or v_qty <= 0 then raise exception 'Item quantity must be positive'; end if;

    select m.name, m.sale_price into v_name, v_price

      from public.menu_items m where m.id = v_menu_id and m.is_active = true;

    if v_name is null then raise exception 'Active menu item not found'; end if;

    v_line := round(v_qty * v_price, 2);

    v_subtotal := v_subtotal + v_line;

  end loop;

  if p_discount > v_subtotal then raise exception 'Discount cannot exceed subtotal'; end if;

  v_total := greatest(0, v_subtotal - p_discount);

  insert into public.sales(client_request_id, unit_id, cashier_user_id, status, subtotal, discount, total, payment_method)

  values (p_client_request_id, p_unit_id, v_user, 'paid', v_subtotal, p_discount, v_total, p_payment_method)

  on conflict (client_request_id) do nothing

  returning id into v_sale_id;

  if v_sale_id is null then

    select s.id, s.unit_id, s.cashier_user_id into v_sale_id, v_existing_unit, v_existing_user

    from public.sales s where s.client_request_id = p_client_request_id;

    if v_existing_unit <> p_unit_id or (v_role <> 'owner' and v_existing_user <> v_user) then

      raise exception 'Idempotency key already used for another transaction';

    end if;

    return jsonb_build_object('sale_id', v_sale_id, 'status', 'existing');

  end if;

  for v_item in select value from jsonb_array_elements(p_items)

  loop

    v_menu_id := (v_item->>'menu_item_id')::uuid;

    v_qty := (v_item->>'quantity')::numeric;

    select m.name, m.sale_price into v_name, v_price

      from public.menu_items m where m.id = v_menu_id and m.is_active = true;

    v_line := round(v_qty * v_price, 2);

    insert into public.sale_items(sale_id, menu_item_id, menu_name_snapshot, quantity, unit_price, line_total)

    values (v_sale_id, v_menu_id, v_name, v_qty, v_price, v_line);

  end loop;

  insert into public.cash_movements(unit_id, movement_type, amount_delta, payment_method, source_type, source_id, note, created_by)

  values (p_unit_id, 'sale_income', v_total, p_payment_method, 'sale', v_sale_id, 'Penjualan', v_user);

  insert into public.audit_logs(actor_user_id, unit_id, action, entity_type, entity_id, details)

  values (v_user, p_unit_id, 'sale_posted', 'sale', v_sale_id::text,

    jsonb_build_object('subtotal', v_subtotal, 'discount', p_discount, 'total', v_total));

  return jsonb_build_object('sale_id', v_sale_id, 'status', 'created', 'subtotal', v_subtotal, 'total', v_total);

end;

$$;

-- Stock receipt: branch cashier receives for branch; kitchen receives for bazaar.

-- Weighted-average cost updates atomically with the movement ledger.

create or replace function public.receive_stock(

  p_unit_id uuid,

  p_ingredient_id uuid,

  p_quantity numeric,

  p_unit_cost numeric,

  p_note text default null,

  p_request_id uuid default gen_random_uuid()

)

returns jsonb

language plpgsql

security definer

set search_path = ''

as $$

declare

  v_user uuid := auth.uid();

  v_role public.app_role;

  v_kind public.unit_kind;

  v_old_qty numeric(14,4);

  v_old_cost numeric(14,4);

  v_new_qty numeric(14,4);

  v_new_cost numeric(14,4);

  v_movement_id uuid;

begin

  if v_user is null then raise exception 'Authentication required'; end if;

  select p.role into v_role from public.user_profiles p

    where p.user_id = v_user and p.is_active = true;

  if v_role is null then raise exception 'Active user profile required'; end if;

  select u.kind into v_kind from public.business_units u where u.id = p_unit_id and u.is_active = true;

  if v_kind is null then raise exception 'Active business unit not found'; end if;

  if v_role <> 'owner' and public.current_unit_id() <> p_unit_id then raise exception 'Unit access denied'; end if;

  if not (

    v_role = 'owner'

    or (v_role = 'cashier' and v_kind = 'branch')

    or (v_role = 'kitchen' and v_kind = 'bazaar')

  ) then raise exception 'Role cannot receive stock for this unit'; end if;

  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be positive'; end if;

  if p_unit_cost is null or p_unit_cost < 0 then raise exception 'Unit cost cannot be negative'; end if;

  if p_request_id is null then raise exception 'Request id is required'; end if;

  if exists (

    select 1 from public.inventory_movements m

    where m.unit_id = p_unit_id and m.ingredient_id = p_ingredient_id

      and m.kind = 'purchase' and m.source_type = 'stock_receipt' and m.source_id = p_request_id

  ) then

    select m.id into v_movement_id from public.inventory_movements m

    where m.unit_id = p_unit_id and m.ingredient_id = p_ingredient_id

      and m.kind = 'purchase' and m.source_type = 'stock_receipt' and m.source_id = p_request_id;

    return jsonb_build_object('movement_id', v_movement_id, 'status', 'existing');

  end if;

  perform 1 from public.ingredients i where i.id = p_ingredient_id and i.is_active = true;

  if not found then raise exception 'Active ingredient not found'; end if;

  insert into public.inventory_balances(unit_id, ingredient_id, quantity, average_unit_cost)

  values (p_unit_id, p_ingredient_id, 0, 0)

  on conflict (unit_id, ingredient_id) do nothing;

  select b.quantity, b.average_unit_cost into v_old_qty, v_old_cost

  from public.inventory_balances b

  where b.unit_id = p_unit_id and b.ingredient_id = p_ingredient_id

  for update;

  v_new_qty := v_old_qty + p_quantity;

  v_new_cost := case when v_new_qty = 0 then 0

    else round(((v_old_qty * v_old_cost) + (p_quantity * p_unit_cost)) / v_new_qty, 4) end;

  update public.inventory_balances

    set quantity = v_new_qty, average_unit_cost = v_new_cost, updated_at = now()

    where unit_id = p_unit_id and ingredient_id = p_ingredient_id;

  insert into public.inventory_movements(unit_id, ingredient_id, kind, quantity_delta, unit_cost, source_type, source_id, note, created_by)

  values (p_unit_id, p_ingredient_id, 'purchase', p_quantity, p_unit_cost, 'stock_receipt', p_request_id, p_note, v_user)

  returning id into v_movement_id;

  insert into public.audit_logs(actor_user_id, unit_id, action, entity_type, entity_id, details)

  values (v_user, p_unit_id, 'stock_received', 'inventory_movement', v_movement_id::text,

    jsonb_build_object('ingredient_id', p_ingredient_id, 'quantity', p_quantity, 'unit_cost', p_unit_cost));

  return jsonb_build_object('movement_id', v_movement_id, 'status', 'created', 'quantity', v_new_qty, 'average_unit_cost', v_new_cost);

end;

$$;

-- Manual stock issue, for spoilage/usage correction only. Sales do not consume stock without recipes.

create or replace function public.issue_stock(

  p_unit_id uuid,

  p_ingredient_id uuid,

  p_quantity numeric,

  p_note text,

  p_request_id uuid default gen_random_uuid()

)

returns jsonb

language plpgsql

security definer

set search_path = ''

as $$

declare

  v_user uuid := auth.uid();

  v_role public.app_role;

  v_kind public.unit_kind;

  v_qty numeric(14,4);

  v_cost numeric(14,4);

  v_movement_id uuid;

begin

  if v_user is null then raise exception 'Authentication required'; end if;

  select p.role into v_role from public.user_profiles p

    where p.user_id = v_user and p.is_active = true;

  if v_role is null then raise exception 'Active user profile required'; end if;

  select u.kind into v_kind from public.business_units u where u.id = p_unit_id and u.is_active = true;

  if v_kind is null then raise exception 'Active business unit not found'; end if;

  if v_role <> 'owner' and public.current_unit_id() <> p_unit_id then raise exception 'Unit access denied'; end if;

  if not (v_role = 'owner' or (v_role = 'cashier' and v_kind = 'branch') or (v_role = 'kitchen' and v_kind = 'bazaar')) then

    raise exception 'Role cannot issue stock';

  end if;

  if p_quantity is null or p_quantity <= 0 then raise exception 'Quantity must be positive'; end if;

  if nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'A reason is required'; end if;

  if p_request_id is null then raise exception 'Request id is required'; end if;

  if exists (

    select 1 from public.inventory_movements m

    where m.unit_id = p_unit_id and m.ingredient_id = p_ingredient_id

      and m.kind = 'manual_out' and m.source_type = 'stock_issue' and m.source_id = p_request_id

  ) then

    select m.id into v_movement_id from public.inventory_movements m

    where m.unit_id = p_unit_id and m.ingredient_id = p_ingredient_id

      and m.kind = 'manual_out' and m.source_type = 'stock_issue' and m.source_id = p_request_id;

    return jsonb_build_object('movement_id', v_movement_id, 'status', 'existing');

  end if;

  select b.quantity, b.average_unit_cost into v_qty, v_cost

  from public.inventory_balances b

  where b.unit_id = p_unit_id and b.ingredient_id = p_ingredient_id

  for update;

  if not found then raise exception 'No stock balance exists'; end if;

  if v_qty < p_quantity then raise exception 'Insufficient stock'; end if;

  update public.inventory_balances

  set quantity = quantity - p_quantity, updated_at = now()

  where unit_id = p_unit_id and ingredient_id = p_ingredient_id;

  insert into public.inventory_movements(unit_id, ingredient_id, kind, quantity_delta, unit_cost, source_type, source_id, note, created_by)

  values (p_unit_id, p_ingredient_id, 'manual_out', -p_quantity, v_cost, 'stock_issue', p_request_id, p_note, v_user)

  returning id into v_movement_id;

  insert into public.audit_logs(actor_user_id, unit_id, action, entity_type, entity_id, details)

  values (v_user, p_unit_id, 'stock_issued', 'inventory_movement', v_movement_id::text,

    jsonb_build_object('ingredient_id', p_ingredient_id, 'quantity', p_quantity, 'note', p_note));

  return jsonb_build_object('movement_id', v_movement_id, 'status', 'created', 'quantity', v_qty - p_quantity);

end;

$$;

-- Owner-only void: writes a reversal in the cash ledger. Stock is not restored because

-- sales are not recipe-linked in this version.

create or replace function public.void_sale(p_sale_id uuid, p_reason text)

returns jsonb

language plpgsql

security definer

set search_path = ''

as $$

declare

  v_user uuid := auth.uid();

  v_sale public.sales%rowtype;

begin

  if v_user is null or public.current_app_role() <> 'owner' then

    raise exception 'Only an authenticated owner can void a sale';

  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Void reason is required'; end if;

  select * into v_sale from public.sales where id = p_sale_id for update;

  if not found then raise exception 'Sale not found'; end if;

  if v_sale.status = 'voided' then

    return jsonb_build_object('sale_id', v_sale.id, 'status', 'already_voided');

  end if;

  update public.sales set status = 'voided', voided_at = now(), void_reason = p_reason

  where id = p_sale_id;

  insert into public.cash_movements(unit_id, movement_type, amount_delta, payment_method, source_type, source_id, note, created_by)

  values (v_sale.unit_id, 'sale_reversal', -v_sale.total, v_sale.payment_method, 'sale_void', v_sale.id, p_reason, v_user);

  insert into public.audit_logs(actor_user_id, unit_id, action, entity_type, entity_id, details)

  values (v_user, v_sale.unit_id, 'sale_voided', 'sale', v_sale.id::text,

    jsonb_build_object('reason', p_reason, 'reversed_amount', v_sale.total));

  return jsonb_build_object('sale_id', v_sale.id, 'status', 'voided');

end;

$$;

-- Owner-only expense posting; expense + cash ledger + audit are atomic.

create or replace function public.post_expense(

  p_unit_id uuid,

  p_description text,

  p_category text,

  p_amount numeric,

  p_expense_date date default current_date

)

returns jsonb

language plpgsql

security definer

set search_path = ''

as $$

declare

  v_user uuid := auth.uid();

  v_expense_id uuid;

begin

  if v_user is null or public.current_app_role() <> 'owner' then

    raise exception 'Only an authenticated owner can post expenses';

  end if;

  if p_description is null or nullif(trim(p_description), '') is null then raise exception 'Description is required'; end if;

  if p_category is null or nullif(trim(p_category), '') is null then raise exception 'Category is required'; end if;

  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;

  if not exists (select 1 from public.business_units u where u.id = p_unit_id and u.is_active = true) then

    raise exception 'Active business unit not found';

  end if;

  insert into public.expenses(unit_id, description, category, amount, expense_date, created_by)

  values (p_unit_id, trim(p_description), trim(p_category), p_amount, coalesce(p_expense_date, current_date), v_user)

  returning id into v_expense_id;

  insert into public.cash_movements(unit_id, movement_type, amount_delta, source_type, source_id, note, created_by)

  values (p_unit_id, 'expense_out', -p_amount, 'expense', v_expense_id, trim(p_description), v_user);

  insert into public.audit_logs(actor_user_id, unit_id, action, entity_type, entity_id, details)

  values (v_user, p_unit_id, 'expense_posted', 'expense', v_expense_id::text,

    jsonb_build_object('amount', p_amount, 'category', p_category));

  return jsonb_build_object('expense_id', v_expense_id, 'status', 'created');

end;

$$;

-- Restrict RPC execution to authenticated users. Function bodies validate role and unit.

revoke all on function public.current_app_role() from public, anon;

revoke all on function public.current_unit_id() from public, anon;

revoke all on function public.is_active_user() from public, anon;

revoke all on function public.can_access_unit(uuid) from public, anon;

revoke all on function public.post_sale(uuid, uuid, public.payment_method, jsonb, numeric) from public, anon;

revoke all on function public.receive_stock(uuid, uuid, numeric, numeric, text, uuid) from public, anon;

revoke all on function public.issue_stock(uuid, uuid, numeric, text, uuid) from public, anon;

revoke all on function public.void_sale(uuid, text) from public, anon;

revoke all on function public.post_expense(uuid, text, text, numeric, date) from public, anon;

grant execute on function public.current_app_role() to authenticated;

grant execute on function public.current_unit_id() to authenticated;

grant execute on function public.is_active_user() to authenticated;

grant execute on function public.can_access_unit(uuid) to authenticated;

grant execute on function public.post_sale(uuid, uuid, public.payment_method, jsonb, numeric) to authenticated;

grant execute on function public.receive_stock(uuid, uuid, numeric, numeric, text, uuid) to authenticated;

grant execute on function public.issue_stock(uuid, uuid, numeric, text, uuid) to authenticated;

grant execute on function public.void_sale(uuid, text) to authenticated;

grant execute on function public.post_expense(uuid, text, text, numeric, date) to authenticated;

-- Seed operational units. Replace display names later if needed, without changing these codes.

insert into public.business_units(code, name, kind) values

  ('branch-1', 'Cabang 1', 'branch'),

  ('branch-2', 'Cabang 2', 'branch'),

  ('bazaar-1', 'Bazar 1', 'bazaar'),

  ('bazaar-2', 'Bazar 2', 'bazaar');

commit;

-- IMPORTANT: create the first auth user in Supabase Authentication, then bootstrap the owner

-- by running a one-time SQL statement as database administrator, replacing the email:

-- insert into public.user_profiles(user_id, display_name, role, unit_id)

-- select id, 'Owner', 'owner', null from auth.users where email = 'YOUR_OWNER_EMAIL';

-- Run that statement only after confirming the email belongs to your owner account.
