-- Warung Medan CT Catering — initial schema baseline.
-- Review and run in a NEW Supabase project. Do not run against the existing production project.
begin;
create extension if not exists pgcrypto;

create type public.app_role as enum ('owner', 'cashier', 'tenant', 'kitchen');
create type public.unit_kind as enum ('branch', 'bazaar');
create type public.sale_status as enum ('draft', 'paid', 'voided');
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
  constraint profile_role_unit_check check ((role = 'owner' and unit_id is null) or (role <> 'owner' and unit_id is not null))
);

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
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
  created_at timestamptz not null default now()
);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(menu_item_id, version)
);

create table public.recipe_ingredients (
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  quantity numeric(14,4) not null check (quantity > 0),
  primary key(recipe_id, ingredient_id)
);

-- One balance row per ingredient per unit. Quantity is maintained by movement posting.
create table public.inventory_balances (
  unit_id uuid not null references public.business_units(id) on delete restrict,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  quantity numeric(14,4) not null default 0,
  average_unit_cost numeric(14,4) not null default 0 check (average_unit_cost >= 0),
  updated_at timestamptz not null default now(),
  primary key(unit_id, ingredient_id),
  constraint balance_nonnegative check (quantity >= 0)
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  client_request_id uuid not null unique,
  unit_id uuid not null references public.business_units(id) on delete restrict,
  cashier_user_id uuid not null references auth.users(id) on delete restrict,
  status public.sale_status not null default 'draft',
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  total numeric(14,2) not null default 0 check (total >= 0),
  payment_method public.payment_method,
  paid_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  constraint sale_total_check check (total = greatest(0, subtotal - discount))
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
create unique index inventory_movements_source_once on public.inventory_movements(unit_id, ingredient_id, kind, source_type, source_id) where source_id is not null;
create index inventory_movements_unit_date_idx on public.inventory_movements(unit_id, created_at desc);
create index sales_unit_date_idx on public.sales(unit_id, created_at desc);

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

-- Security-definer helpers avoid RLS policy recursion on user_profiles.
create or replace function public.current_app_role()
returns public.app_role language sql stable security definer set search_path = ''
as $$ select p.role from public.user_profiles p where p.user_id = (select auth.uid()) and p.is_active = true limit 1 $$;

create or replace function public.current_unit_id()
returns uuid language sql stable security definer set search_path = ''
as $$ select p.unit_id from public.user_profiles p where p.user_id = (select auth.uid()) and p.is_active = true limit 1 $$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.user_profiles p where p.user_id = (select auth.uid()) and p.is_active = true) $$;

create or replace function public.can_access_unit(target_unit uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select public.current_app_role() = 'owner' or public.current_unit_id() = target_unit $$;

-- New auth users receive no operational role by default; owner must provision their profile.
-- Do not add a public profile self-signup policy: users must not assign their own role/unit.

alter table public.business_units enable row level security;
alter table public.user_profiles enable row level security;
alter table public.ingredients enable row level security;
alter table public.menu_items enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.inventory_balances enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.expenses enable row level security;
alter table public.audit_logs enable row level security;

create policy "active users read units" on public.business_units for select to authenticated using (public.is_active_user() and (public.current_app_role() = 'owner' or id = public.current_unit_id()));
create policy "owner manages units" on public.business_units for all to authenticated using (public.current_app_role() = 'owner') with check (public.current_app_role() = 'owner');
create policy "users read own profile or owner reads all" on public.user_profiles for select to authenticated using (user_id = (select auth.uid()) or public.current_app_role() = 'owner');
create policy "owner manages profiles" on public.user_profiles for all to authenticated using (public.current_app_role() = 'owner') with check (public.current_app_role() = 'owner');

create policy "active users read ingredients" on public.ingredients for select to authenticated using (public.is_active_user());
create policy "owner manages ingredients" on public.ingredients for all to authenticated using (public.current_app_role() = 'owner') with check (public.current_app_role() = 'owner');
create policy "active users read menu" on public.menu_items for select to authenticated using (public.is_active_user());
create policy "owner manages menu" on public.menu_items for all to authenticated using (public.current_app_role() = 'owner') with check (public.current_app_role() = 'owner');
create policy "active users read recipes" on public.recipes for select to authenticated using (public.is_active_user());
create policy "owner manages recipes" on public.recipes for all to authenticated using (public.current_app_role() = 'owner') with check (public.current_app_role() = 'owner');
create policy "active users read recipe ingredients" on public.recipe_ingredients for select to authenticated using (public.is_active_user());
create policy "owner manages recipe ingredients" on public.recipe_ingredients for all to authenticated using (public.current_app_role() = 'owner') with check (public.current_app_role() = 'owner');

create policy "read inventory balances in assigned units" on public.inventory_balances for select to authenticated using (public.is_active_user() and public.can_access_unit(unit_id));
create policy "owner manages inventory balances" on public.inventory_balances for all to authenticated using (public.current_app_role() = 'owner') with check (public.current_app_role() = 'owner');
create policy "read sales in assigned units" on public.sales for select to authenticated using (public.is_active_user() and public.can_access_unit(unit_id));
create policy "read sale items through parent sale" on public.sale_items for select to authenticated using (exists(select 1 from public.sales s where s.id = sale_id and public.can_access_unit(s.unit_id)));
create policy "read inventory movements in assigned units" on public.inventory_movements for select to authenticated using (public.is_active_user() and public.can_access_unit(unit_id));
create policy "owner can manage inventory movements" on public.inventory_movements for all to authenticated using (public.current_app_role() = 'owner') with check (public.current_app_role() = 'owner');
create policy "read expenses in assigned units" on public.expenses for select to authenticated using (public.is_active_user() and public.can_access_unit(unit_id));
create policy "owner manages expenses" on public.expenses for all to authenticated using (public.current_app_role() = 'owner') with check (public.current_app_role() = 'owner');
create policy "owner reads audit logs" on public.audit_logs for select to authenticated using (public.current_app_role() = 'owner');
create policy "active users add audit logs for own unit" on public.audit_logs for insert to authenticated with check (public.is_active_user() and (public.current_app_role() = 'owner' or unit_id = public.current_unit_id()) and actor_user_id = (select auth.uid()));

-- Deliberately no direct insert/update/delete policy for sales, sale_items, or stock balances.
-- Production transactions must go through reviewed database RPCs so sale, stock and cash are atomic.

insert into public.business_units(code, name, kind) values
  ('branch-1', 'Cabang 1', 'branch'),
  ('branch-2', 'Cabang 2', 'branch'),
  ('bazaar-1', 'Bazar 1', 'bazaar'),
  ('bazaar-2', 'Bazar 2', 'bazaar');

commit;
