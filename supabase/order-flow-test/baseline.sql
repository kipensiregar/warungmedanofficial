-- Disposable PostgreSQL fixture only. This is not a Production schema dump.
-- It includes the locally defined business/helper structures plus the
-- kitchen-order columns and constraints required by the three review drafts.
-- Values are synthetic and inserted only by assertions.sql.

begin;

create extension if not exists pgcrypto;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'create role anon nologin';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'create role authenticated nologin';
  end if;
end
$roles$;

create schema auth;
create schema order_flow_test;

create table order_flow_test.protected_function_definitions (
  signature text primary key,
  definition text not null
);

create table auth.users (id uuid primary key);

create function auth.uid()
returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create type public.app_role as enum ('owner', 'cashier', 'tenant', 'kitchen');
create type public.unit_kind as enum ('branch', 'bazaar');
create type public.payment_method as enum ('cash', 'bank_transfer', 'qris', 'debit', 'other');

create table public.business_units (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  kind public.unit_kind not null,
  is_active boolean not null default true
);

create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null,
  unit_id uuid references public.business_units(id),
  is_active boolean not null default true
);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sale_price numeric(14,2) not null check (sale_price >= 0),
  is_active boolean not null default true
);

create table public.sales (
  id uuid primary key default gen_random_uuid()
);

create table public.kitchen_orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  client_request_id uuid not null unique,
  unit_id uuid not null references public.business_units(id),
  created_by uuid not null references auth.users(id),
  service_type text not null check (service_type in ('dine_in', 'takeaway')),
  table_number text,
  status text not null default 'queued' check (status in ('queued', 'preparing', 'ready', 'served', 'cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid', 'cancelled')),
  subtotal numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  parent_order_id uuid references public.kitchen_orders(id),
  round_number integer not null default 1,
  paid_sale_id uuid references public.sales(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (service_type <> 'takeaway' or table_number is null)
);

create unique index kitchen_orders_parent_round_unique
  on public.kitchen_orders(parent_order_id, round_number)
  where parent_order_id is not null;

create table public.kitchen_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.kitchen_orders(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id),
  menu_name_snapshot text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  item_notes text,
  is_prepared boolean not null default false
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id),
  unit_id uuid references public.business_units(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Sentinel definitions make this test fail if a draft replaces either legacy
-- payment/sales function. They are intentionally not implementations of those
-- Production functions.
create function public.pay_kitchen_order(
  p_order_id uuid,
  p_payment_method public.payment_method,
  p_discount numeric default 0
) returns jsonb language sql as $$ select jsonb_build_object('fixture', 'pay_kitchen_order') $$;

create function public.post_sale(
  p_client_request_id uuid,
  p_unit_id uuid,
  p_payment_method public.payment_method,
  p_items jsonb,
  p_discount numeric default 0
) returns jsonb language sql as $$ select jsonb_build_object('fixture', 'post_sale') $$;

insert into order_flow_test.protected_function_definitions(signature, definition)
select p.oid::regprocedure::text, pg_get_functiondef(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.oid in (
    'public.pay_kitchen_order(uuid,public.payment_method,numeric)'::regprocedure,
    'public.post_sale(uuid,uuid,public.payment_method,jsonb,numeric)'::regprocedure
  );

grant usage on schema public, auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

commit;
