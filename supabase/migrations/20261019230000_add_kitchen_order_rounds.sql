
-- Warung Medan: additive kitchen order rounds migration.
-- Preserves existing orders and their original IDs.

ALTER TABLE public.kitchen_orders
  ADD COLUMN IF NOT EXISTS parent_order_id uuid
  REFERENCES public.kitchen_orders(id)
  ON DELETE RESTRICT;

ALTER TABLE public.kitchen_orders
  ADD COLUMN IF NOT EXISTS round_number integer
  NOT NULL DEFAULT 1;

-- A round number must be positive.
ALTER TABLE public.kitchen_orders
  ADD CONSTRAINT kitchen_orders_round_number_positive
  CHECK (round_number >= 1);

-- Prevent duplicate round numbers for a parent order.
CREATE UNIQUE INDEX IF NOT EXISTS
  kitchen_orders_parent_round_unique
ON public.kitchen_orders (parent_order_id, round_number)
WHERE parent_order_id IS NOT NULL;

-- Efficiently retrieve all rounds for a main order.
CREATE INDEX IF NOT EXISTS
  kitchen_orders_parent_order_idx
ON public.kitchen_orders (parent_order_id);

-- Root orders must remain round 1.
CREATE INDEX IF NOT EXISTS
  kitchen_orders_root_round_idx
ON public.kitchen_orders (id)
WHERE parent_order_id IS NULL AND round_number = 1;
