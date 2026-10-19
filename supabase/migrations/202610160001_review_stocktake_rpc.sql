
CREATE OR REPLACE FUNCTION public.review_stocktake(
  p_stocktake_id uuid,
  p_approve boolean,
  p_review_note text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_s public.stocktakes%rowtype;
  v_item record;
  v_current_qty numeric(14,4);
  v_current_updated_at timestamptz;
  v_delta numeric(14,4);
  v_movement_id uuid;
  v_count integer := 0;
BEGIN
  IF v_user IS NULL OR NOT public.is_active_user()
     OR public.current_app_role()::text <> 'owner' THEN
    RAISE EXCEPTION 'Hanya Owner aktif yang dapat meninjau opname';
  END IF;

  IF p_review_note IS NULL OR length(trim(p_review_note)) < 3 THEN
    RAISE EXCEPTION 'Catatan pemeriksaan wajib diisi (minimal 3 karakter)';
  END IF;

  SELECT * INTO v_s
  FROM public.stocktakes
  WHERE id = p_stocktake_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pengajuan opname tidak ditemukan';
  END IF;

  IF v_s.status <> 'pending' THEN
    RAISE EXCEPTION 'Pengajuan sudah ditinjau';
  END IF;

  IF v_s.submitted_by = v_user AND p_approve THEN
    RAISE EXCEPTION 'Owner tidak boleh menyetujui opname yang dibuat sendiri';
  END IF;

  IF NOT p_approve THEN
    UPDATE public.stocktakes
    SET status = 'rejected',
        reviewed_by = v_user,
        reviewed_at = now(),
        review_note = trim(p_review_note),
        updated_at = now()
    WHERE id = p_stocktake_id;

    INSERT INTO public.audit_logs(
      actor_user_id, unit_id, action,
      entity_type, entity_id, details
    )
    VALUES (
      v_user, v_s.unit_id, 'stocktake_rejected',
      'stocktake', p_stocktake_id::text,
      jsonb_build_object('note', trim(p_review_note))
    );

    RETURN jsonb_build_object(
      'status', 'rejected',
      'stocktake_id', p_stocktake_id
    );
  END IF;

  -- Validasi snapshot saldo sebelum koreksi.
  FOR v_item IN
    SELECT si.*, i.name AS ingredient_name
    FROM public.stocktake_items si
    JOIN public.ingredients i ON i.id = si.ingredient_id
    WHERE si.stocktake_id = p_stocktake_id
    ORDER BY si.ingredient_id
  LOOP
    SELECT b.quantity, b.updated_at
    INTO v_current_qty, v_current_updated_at
    FROM public.inventory_balances b
    WHERE b.unit_id = v_s.unit_id
      AND b.ingredient_id = v_item.ingredient_id
    FOR UPDATE;

    IF NOT FOUND THEN
      IF round(v_item.system_quantity, 4) <> 0
         OR v_item.snapshot_updated_at IS NOT NULL THEN

        UPDATE public.stocktakes
        SET status = 'stale',
            reviewed_by = v_user,
            reviewed_at = now(),
            review_note = 'Saldo berubah sejak opname dibuat. Lakukan opname ulang.',
            updated_at = now()
        WHERE id = p_stocktake_id;

        INSERT INTO public.audit_logs(
          actor_user_id, unit_id, action,
          entity_type, entity_id, details
        )
        VALUES (
          v_user, v_s.unit_id, 'stocktake_stale',
          'stocktake', p_stocktake_id::text,
          jsonb_build_object(
            'ingredient_id', v_item.ingredient_id,
            'reason', 'balance_missing'
          )
        );

        RETURN jsonb_build_object(
          'status', 'stale',
          'stocktake_id', p_stocktake_id,
          'message', 'Saldo berubah sejak pengajuan. Lakukan opname ulang.'
        );
      END IF;

    ELSIF round(coalesce(v_current_qty, 0), 4)
            <> round(v_item.system_quantity, 4)
       OR v_current_updated_at IS DISTINCT FROM v_item.snapshot_updated_at THEN

      UPDATE public.stocktakes
      SET status = 'stale',
          reviewed_by = v_user,
          reviewed_at = now(),
          review_note = 'Saldo berubah sejak opname dibuat. Lakukan opname ulang.',
          updated_at = now()
      WHERE id = p_stocktake_id;

      INSERT INTO public.audit_logs(
        actor_user_id, unit_id, action,
        entity_type, entity_id, details
      )
      VALUES (
        v_user, v_s.unit_id, 'stocktake_stale',
        'stocktake', p_stocktake_id::text,
        jsonb_build_object(
          'ingredient_id', v_item.ingredient_id,
          'reason', 'snapshot_changed'
        )
      );

      RETURN jsonb_build_object(
        'status', 'stale',
        'stocktake_id', p_stocktake_id,
        'message', 'Saldo berubah sejak pengajuan. Lakukan opname ulang.'
      );
    END IF;
  END LOOP;

  -- Terapkan koreksi hanya jika selisih bukan nol.
  FOR v_item IN
    SELECT si.*, i.name AS ingredient_name
    FROM public.stocktake_items si
    JOIN public.ingredients i ON i.id = si.ingredient_id
    WHERE si.stocktake_id = p_stocktake_id
    ORDER BY si.ingredient_id
  LOOP
    v_delta := round(
      v_item.counted_base_quantity - v_item.system_quantity,
      4
    );

    IF v_delta <> 0 THEN
      INSERT INTO public.inventory_balances(
        unit_id, ingredient_id, quantity, average_unit_cost
      )
      VALUES (
        v_s.unit_id,
        v_item.ingredient_id,
        v_item.counted_base_quantity,
        coalesce(v_item.average_unit_cost_snapshot, 0)
      )
      ON CONFLICT (unit_id, ingredient_id)
      DO UPDATE SET
        quantity = excluded.quantity,
        updated_at = now();

      INSERT INTO public.inventory_movements(
        unit_id, ingredient_id, kind, quantity_delta, unit_cost,
        source_type, source_id, note, created_by
      )
      VALUES (
        v_s.unit_id,
        v_item.ingredient_id,
        'stocktake_adjustment',
        v_delta,
        v_item.average_unit_cost_snapshot,
        'stocktake',
        p_stocktake_id,
        'KOREKSI STOK OPNAME disetujui Owner: ' || trim(p_review_note),
        v_user
      )
      RETURNING id INTO v_movement_id;

      UPDATE public.inventory_movements
      SET input_quantity = abs(v_delta),
          input_unit = v_item.base_unit,
          conversion_factor = 1,
          base_quantity = abs(v_delta)
      WHERE id = v_movement_id;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  UPDATE public.stocktakes
  SET status = 'approved',
      reviewed_by = v_user,
      reviewed_at = now(),
      review_note = trim(p_review_note),
      approved_at_balance_check = true,
      updated_at = now()
  WHERE id = p_stocktake_id;

  INSERT INTO public.audit_logs(
    actor_user_id, unit_id, action,
    entity_type, entity_id, details
  )
  VALUES (
    v_user, v_s.unit_id, 'stocktake_approved',
    'stocktake', p_stocktake_id::text,
    jsonb_build_object(
      'items', v_count,
      'note', trim(p_review_note)
    )
  );

  RETURN jsonb_build_object(
    'status', 'approved',
    'stocktake_id', p_stocktake_id,
    'items', v_count
  );
END;
$function$;
