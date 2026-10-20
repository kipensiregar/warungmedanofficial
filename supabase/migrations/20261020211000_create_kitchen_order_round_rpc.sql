
-- Warung Medan: create an additional kitchen-order round.
-- Additive RPC; does not replace existing order/payment functions.

CREATE OR REPLACE FUNCTION public.submit_kitchen_order_round(
  p_client_request_id uuid,
  p_parent_order_id uuid,
  p_items jsonb,
  p_notes text DEFAULT NULL
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
  v_existing public.kitchen_orders%ROWTYPE;
  v_order_id uuid;
  v_order_number bigint;
  v_round_number integer;
  v_item jsonb;
  v_menu_id uuid;
  v_qty numeric(14,3);
  v_price numeric(14,2);
  v_name text;
  v_line numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_unit_kind public.unit_kind;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT p.role
  INTO v_role
  FROM public.user_profiles p
  WHERE p.user_id = v_user
    AND p.is_active = true;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Active user profile required';
  END IF;

  IF v_role NOT IN ('owner', 'cashier', 'tenant') THEN
    RAISE EXCEPTION 'Role cannot create kitchen orders';
  END IF;

  IF p_client_request_id IS NULL OR p_parent_order_id IS NULL THEN
    RAISE EXCEPTION 'Request id and parent order id are required';
  END IF;

  IF p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item';
  END IF;

  -- Lock the root order before checking or allocating a round.
  SELECT o.*
  INTO v_root
  FROM public.kitchen_orders o
  WHERE o.id = p_parent_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Main order not found';
  END IF;

  IF v_root.parent_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'Parent id must reference a main order';
  END IF;

  IF v_role <> 'owner'
     AND public.current_unit_id() IS DISTINCT FROM v_root.unit_id THEN
    RAISE EXCEPTION 'Unit access denied';
  END IF;

  SELECT u.kind
  INTO v_unit_kind
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

  -- Repeated request: verify the existing request matches
  -- the same creator, unit, and parent before returning it.
  SELECT o.*
  INTO v_existing
  FROM public.kitchen_orders o
  WHERE o.client_request_id = p_client_request_id;

  IF FOUND THEN
    IF v_existing.created_by <> v_user
       OR v_existing.unit_id <> v_root.unit_id
       OR v_existing.parent_order_id IS DISTINCT FROM p_parent_order_id THEN
      RAISE EXCEPTION 'Request id already used by another order';
    END IF;

    RETURN jsonb_build_object(
      'order_id', v_existing.id,
      'order_number', v_existing.order_number,
      'round_number', v_existing.round_number,
      'status', 'already_exists',
      'payment_status', v_existing.payment_status,
      'total', v_existing.total
    );
  END IF;

  IF v_root.payment_status <> 'unpaid'
     OR v_root.status = 'cancelled' THEN
    RAISE EXCEPTION 'Main order is not open for additional rounds';
  END IF;

  SELECT COALESCE(MAX(o.round_number), 1) + 1
  INTO v_round_number
  FROM public.kitchen_orders o
  WHERE o.id = p_parent_order_id
     OR o.parent_order_id = p_parent_order_id;

  INSERT INTO public.kitchen_orders (
    client_request_id,
    unit_id,
    created_by,
    service_type,
    table_number,
    notes,
    parent_order_id,
    round_number
  )
  VALUES (
    p_client_request_id,
    v_root.unit_id,
    v_user,
    v_root.service_type,
    v_root.table_number,
    NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    p_parent_order_id,
    v_round_number
  )
  RETURNING id, order_number
  INTO v_order_id, v_order_number;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_menu_id := (v_item->>'menu_item_id')::uuid;
      v_qty := (v_item->>'quantity')::numeric;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Invalid order item payload';
    END;

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Item quantity must be positive';
    END IF;

    SELECT m.name, m.sale_price
    INTO v_name, v_price
    FROM public.menu_items m
    WHERE m.id = v_menu_id
      AND m.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Active menu item not found: %', v_menu_id;
    END IF;

    v_line := ROUND(v_price * v_qty, 2);
    v_subtotal := v_subtotal + v_line;

    INSERT INTO public.kitchen_order_items (
      order_id,
      menu_item_id,
      menu_name_snapshot,
      quantity,
      unit_price,
      line_total,
      item_notes
    )
    VALUES (
      v_order_id,
      v_menu_id,
      v_name,
      v_qty,
      v_price,
      v_line,
      NULLIF(TRIM(COALESCE(v_item->>'notes', '')), '')
    );
  END LOOP;

  UPDATE public.kitchen_orders
  SET subtotal = v_subtotal,
      total = v_subtotal,
      updated_at = now()
  WHERE id = v_order_id;

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
    'create',
    'kitchen_order_round',
    v_order_id::text,
    jsonb_build_object(
      'parent_order_id', p_parent_order_id,
      'round_number', v_round_number,
      'order_number', v_order_number,
      'total', v_subtotal
    )
  );

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'parent_order_id', p_parent_order_id,
    'order_number', v_order_number,
    'round_number', v_round_number,
    'status', 'queued',
    'payment_status', 'unpaid',
    'total', v_subtotal
  );
END;
$function$;

REVOKE ALL ON FUNCTION
  public.submit_kitchen_order_round(uuid, uuid, jsonb, text)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.submit_kitchen_order_round(uuid, uuid, jsonb, text)
TO authenticated;
