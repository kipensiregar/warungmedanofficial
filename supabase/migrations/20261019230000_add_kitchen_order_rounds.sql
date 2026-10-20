
-- Additive migration: kitchen order rounds.
-- Preserves existing orders and data.

ALTER TABLE public.kitchen_orders
  ADD COLUMN IF NOT EXISTS parent_order_id uuid
  REFERENCES public.kitchen_orders(id)
  ON DELETE RESTRICT;

ALTER TABLE public.kitchen_orders
  ADD COLUMN IF NOT EXISTS round_number integer
  NOT NULL DEFAULT 1;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.kitchen_orders'::regclass
      AND conname = 'kitchen_orders_round_number_positive'
  ) THEN
    ALTER TABLE public.kitchen_orders
      ADD CONSTRAINT kitchen_orders_round_number_positive
      CHECK (round_number >= 1);
  END IF;
END
$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS
  kitchen_orders_parent_round_unique
ON public.kitchen_orders (parent_order_id, round_number)
WHERE parent_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS
  kitchen_orders_parent_order_idx
ON public.kitchen_orders (parent_order_id);
