
-- Warung Medan: pay all rounds as one sale.
-- Requires parent_order_id and round_number migration.

CREATE OR REPLACE FUNCTION public.pay_kitchen_order(
  p_order_id uuid,
  p_payment_method public.payment_method,
  p_discount numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_role public.app_role;
  v_root public.kitchen_orders%ROWTYPE;
  v_order public.kitchen_orders%ROWTYPE;
  v_unit_kind public.unit_kind;
  v_sale_id uuid;
  v_subtotal numeric(14,2);
  v_discount numeric(14,2);
  v_total numeric(14,2);
  v_round_count integer;
  v_paid_count integer;
  v_unpaid_count integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT p.role INTO v_role
  FROM public.user_profiles p
  WHERE p.user_id = v_user
    AND p.is_active = true;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Active user profile required';
  END IF;

  IF v_role NOT IN ('owner', 'cashier', 'tenant') THEN
    RAISE EXCEPTION 'Role cannot pay kitchen orders';
  END IF;

  -- Resolve the supplied order or round to its main order.
  SELECT o.* INTO v_order
  FROM public.kitchen_orders o
  WHERE o.id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kitchen order not found';
  END IF;

  SELECT o.* INTO v_root
  FROM public.kitchen_orders o
  WHERE o.id = COALESCE(v_order.parent_order_id, v_order.id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Main order not found';
  END IF;

  IF v_role <> 'owner'
     AND public.current_unit_id() IS DISTINCT FROM v_root.unit_id THEN
    RAISE EXCEPTION 'Unit access denied';
  END IF;

  SELECT u.kind INTO v_unit_kind
  FROM public.business_units u
  WHERE u.id = v_root.unit_id
    AND u.is_active = true;

  IF v_unit_kind IS NULL THEN
    RAISE EXCEPTION 'Active business unit not found';
  END IF;

  IF (v_role = 'tenant' AND v_unit_kind <> 'bazaar')
     OR (v_role = 'cashier' AND v_unit_kind <> 'branch') THEN
    RAISE EXCEPTION 'Role is not assigned to this unit type';
  END IF;

  -- Serialize payment and lock every order in this group.
  PERFORM 1
  FROM public.kitchen_orders o
  WHERE o.id = v_root.id
     OR o.parent_order_id = v_root.id
  ORDER BY o.id
  FOR UPDATE;

  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE o.payment_status = 'paid')::integer,
    COUNT(*) FILTER (WHERE o.payment_status = 'unpaid')::integer
  INTO v_round_count, v_paid_count, v_unpaid_count
  FROM public.kitchen_orders o
  WHERE o.id = v_root.id
     OR o.parent_order_id = v_root.id;

  IF v_paid_count = v_round_count THEN
    IF v_root.paid_sale_id IS NULL THEN
      RAISE EXCEPTION 'Orders are paid but main order has no linked sale';
    END IF;

    RETURN jsonb_build_object(
      'status', 'already_paid',
      'order_id', v_root.id,
      'sale_id', v_root.paid_sale_id
    );
  END IF;

  IF v_unpaid_count <> v_round_count THEN
    RAISE EXCEPTION 'Order rounds have inconsistent payment statuses';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.kitchen_orders o
    WHERE (o.id = v_root.id OR o.parent_order_id = v_root.id)
      AND o.status = 'cancelled'
  ) THEN
    RAISE EXCEPTION 'Cannot pay an order group containing cancelled rounds';
  END IF;

  IF p_discount IS NULL OR p_discount < 0 THEN
    RAISE EXCEPTION 'Discount must be zero or greater';
  END IF;

  SELECT COALESCE(SUM(o.subtotal), 0)::numeric(14,2)
  INTO v_subtotal
  FROM public.kitchen_orders o
  WHERE o.id = v_root.id
     OR o.parent_order_id = v_root.id;

  v_discount := p_discount;

  IF v_discount > v_subtotal THEN
    RAISE EXCEPTION 'Discount cannot exceed subtotal';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.kitchen_order_items i
    JOIN public.kitchen_orders o ON o.id = i.order_id
    WHERE o.id = v_root.id
       OR o.parent_order_id = v_root.id
  ) THEN
    RAISE EXCEPTION 'Kitchen order group has no items';
  END IF;

  INSERT INTO public.sales (
    client_request_id,
    unit_id,
    cashier_user_id,
    status,
    subtotal,
    discount,
    total,
    payment_method
  )
  VALUES (
    v_root.payment_request_id,
    v_root.unit_id,
    v_user,
    'paid',
    v_subtotal,
    v_discount,
    v_subtotal - v_discount,
    p_payment_method
  )
  RETURNING id INTO v_sale_id;

  INSERT INTO public.sale_items (
    sale_id,
    menu_item_id,
    menu_name_snapshot,
    quantity,
    unit_price,
    line_total
  )
  SELECT
    v_sale_id,
    i.menu_item_id,
    i.menu_name_snapshot,
    i.quantity,
    i.unit_price,
    i.line_total
  FROM public.kitchen_order_items i
  JOIN public.kitchen_orders o ON o.id = i.order_id
  WHERE o.id = v_root.id
     OR o.parent_order_id = v_root.id;

  v_total := v_subtotal - v_discount;

  INSERT INTO public.cash_movements (
    unit_id,
    movement_type,
    amount_delta,
    payment_method,
    source_type,
    source_id,
    note,
    created_by
  )
  VALUES (
    v_root.unit_id,
    'sale_income',
    v_total,
    p_payment_method,
    'sale',
    v_sale_id,
    'Pembayaran pesanan #' || v_root.order_number
      || ' (' || v_round_count || ' ronde)',
    v_user
  );

  -- Every round links to the same sale.
  -- Keep the aggregate discount and total on the main order only.
  UPDATE public.kitchen_orders o
  SET payment_status = 'paid',
      paid_sale_id = v_sale_id,
      discount = CASE WHEN o.id = v_root.id THEN v_discount ELSE 0 END,
      total = CASE WHEN o.id = v_root.id
                   THEN v_total ELSE o.subtotal END,
      paid_at = now(),
      updated_at = now()
  WHERE o.id = v_root.id
     OR o.parent_order_id = v_root.id;

  INSERT INTO public.audit_logs (
    actor_user_id,
    unit_id,
    action,
    entity_type,
    entity_id,
    details
  )
  VALUES (
    v_user,
    v_root.unit_id,
    'kitchen_order_paid',
    'kitchen_order',
    v_root.id,
    jsonb_build_object(
      'sale_id', v_sale_id,
      'round_count', v_round_count,
      'subtotal', v_subtotal,
      'discount', v_discount,
      'total', v_total,
      'payment_method', p_payment_method
    )
  );

  RETURN jsonb_build_object(
    'status', 'paid',
    'order_id', v_root.id,
    'sale_id', v_sale_id,
    'round_count', v_round_count,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'total', v_total
  );
END;
$function$;

REVOKE ALL ON FUNCTION
  public.pay_kitchen_order(uuid, public.payment_method, numeric)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.pay_kitchen_order(uuid, public.payment_method, numeric)
TO authenticated;
