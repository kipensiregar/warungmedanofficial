-- REVIEW ONLY; deliberately outside supabase/migrations.
-- DO NOT RUN against PRODUCTION. Requires schema, policy, grant, trigger, and
-- duplicate-data review plus explicit owner approval. No RPC is created here.

begin;

do $preflight$
begin
  if to_regclass('public.kitchen_orders') is null
    or to_regclass('public.kitchen_order_items') is null then
    raise exception 'Verified kitchen tables are required';
  end if;
  if exists (
    select 1 from public.kitchen_orders
    where parent_order_id is null and service_type = 'dine_in'
      and payment_status = 'unpaid' and status <> 'cancelled'
      and nullif(trim(table_number), '') is not null
    group by unit_id, lower(trim(table_number)) having count(*) > 1
  ) then
    raise exception 'Resolve duplicate active dine-in roots before indexing';
  end if;
end
$preflight$;

alter table public.kitchen_order_items
  add column if not exists preparation_status text not null default 'queued';

update public.kitchen_order_items
set preparation_status = 'ready'
where is_prepared and preparation_status = 'queued';

do $constraint$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.kitchen_order_items'::regclass
      and conname = 'kitchen_order_items_preparation_status_check'
  ) then
    alter table public.kitchen_order_items
      add constraint kitchen_order_items_preparation_status_check
      check (preparation_status in ('queued', 'preparing', 'ready')) not valid;
  end if;
end
$constraint$;

alter table public.kitchen_order_items
  validate constraint kitchen_order_items_preparation_status_check;

alter table public.kitchen_orders
  add column if not exists request_payload_hash text;

-- Production metadata enforces takeaway => table_number IS NULL. Keep the
-- cashier's takeaway label in its own field instead of violating that check.
alter table public.kitchen_orders
  add column if not exists customer_label text;

create unique index if not exists kitchen_orders_one_open_dine_in_root
  on public.kitchen_orders(unit_id, (lower(trim(table_number))))
  where parent_order_id is null and service_type = 'dine_in'
    and payment_status = 'unpaid' and status <> 'cancelled'
    and nullif(trim(table_number), '') is not null;

create index if not exists kitchen_orders_unit_payment_created_idx
  on public.kitchen_orders(unit_id, payment_status, created_at desc);
create index if not exists kitchen_order_items_order_id_idx
  on public.kitchen_order_items(order_id);

commit;

-- Manual rollback only after stopping RPC callers and verifying data impact.
-- The first two indexes are created by this draft and may be dropped if no
-- application depends on them. kitchen_order_items_order_id_idx already exists
-- in Production; CREATE INDEX IF NOT EXISTS is a no-op for it, so do not drop it.
-- Dropping these columns loses idempotency history, takeaway labels, and item
-- preparation states written after deployment; archive/retain them unless that
-- loss is explicitly accepted.
-- DROP INDEX public.kitchen_orders_one_open_dine_in_root;
-- DROP INDEX public.kitchen_orders_unit_payment_created_idx;
-- ALTER TABLE public.kitchen_orders DROP COLUMN request_payload_hash;
-- ALTER TABLE public.kitchen_orders DROP COLUMN customer_label;
-- ALTER TABLE public.kitchen_order_items DROP COLUMN preparation_status;
