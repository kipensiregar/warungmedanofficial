
-- Additive migration: kitchen order rounds
-- Does not delete or rewrite existing orders.

ALTER TABLE public.kitchen_orders
  ADD COLUMN IF NOT EXISTS parent_order_id uuid
  REFERENCES public.kitchen_orders(id)
  ON DELETE RESTRICT;

ALTER TABLE public.kitchen_orders
  ADD COLUMN IF NOT EXISTS round_number integer
  NOT NULL DEFAULT 1;

-- Prevent duplicate round numbers under the same parent order.
CREATE UNIQUE INDEX IF NOT EXISTS
  kitchen_orders_parent_round_unique
ON public.kitchen_orders (parent_order_id, round_number)
WHERE parent_order_id IS NOT NULL;

-- Help retrieve all rounds belonging to a main order.
CREATE INDEX IF NOT EXISTS
  kitchen_orders_parent_order_idx
ON public.kitchen_orders (parent_order_id);
