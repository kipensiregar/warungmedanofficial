-- Runs only against the disposable PostgreSQL service from order-flow-sql-test.yml.
-- All users, units, and menu rows below are synthetic test fixtures.

do $metadata_checks$
declare
  v_signature text;
  v_oid oid;
  v_acl aclitem[];
  v_argument_names text[];
  v_owner text;
  v_owner_bypasses_rls boolean;
begin
  foreach v_signature in array array[
    'public.create_kitchen_order(uuid,uuid,text,text,text,jsonb)',
    'public.append_kitchen_round(uuid,uuid,jsonb)',
    'public.set_kitchen_item_preparation(uuid,text)',
    'public.list_kitchen_orders(uuid)'
  ] loop
    v_oid := to_regprocedure(v_signature);
    if v_oid is null then raise exception 'Missing expected RPC signature: %', v_signature; end if;
    if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
      raise exception 'authenticated lacks EXECUTE: %', v_signature;
    end if;
    if has_function_privilege('anon', v_oid, 'EXECUTE') then
      raise exception 'anon unexpectedly has EXECUTE: %', v_signature;
    end if;
    select p.proacl into v_acl from pg_proc p where p.oid = v_oid;
    if exists (
      select 1 from aclexplode(coalesce(v_acl, acldefault('f', (select proowner from pg_proc where oid = v_oid)))) a
      where a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) then
      raise exception 'PUBLIC unexpectedly has EXECUTE: %', v_signature;
    end if;
    if not (select prosecdef from pg_proc where oid = v_oid) then
      raise exception 'RPC is not SECURITY DEFINER: %', v_signature;
    end if;
    select r.rolname,r.rolbypassrls into v_owner,v_owner_bypasses_rls
    from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid=v_oid;
    if v_owner <> 'postgres' or not coalesce(v_owner_bypasses_rls,false) then
      raise exception 'RPC owner must be postgres with BYPASSRLS: % (owner %, bypass %)', v_signature,v_owner,v_owner_bypasses_rls;
    end if;
    select proargnames[1:pronargs] into v_argument_names from pg_proc where oid = v_oid;
    if v_signature like '%create_kitchen_order%' and v_argument_names <> array[
      'p_request_id', 'p_unit_id', 'p_service_type', 'p_table_number', 'p_customer_label', 'p_items'
    ] then raise exception 'create_kitchen_order argument names differ: %', v_argument_names; end if;
    if v_signature like '%append_kitchen_round%' and v_argument_names <> array[
      'p_request_id', 'p_root_order_id', 'p_items'
    ] then raise exception 'append_kitchen_round argument names differ: %', v_argument_names; end if;
    if v_signature like '%set_kitchen_item_preparation%' and v_argument_names <> array[
      'p_item_id', 'p_target_status'
    ] then raise exception 'set_kitchen_item_preparation argument names differ: %', v_argument_names; end if;
    if v_signature like '%list_kitchen_orders%' and v_argument_names <> array['p_unit_id'] then
      raise exception 'list_kitchen_orders argument names differ: %', v_argument_names;
    end if;
  end loop;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'kitchen_order_items'
      and column_name = 'preparation_status' and data_type = 'text' and is_nullable = 'NO'
  ) then raise exception 'Schema draft did not add required preparation_status column'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'kitchen_orders'
      and column_name = 'request_payload_hash' and data_type = 'text'
  ) then raise exception 'Schema draft did not add request_payload_hash'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'kitchen_orders'
      and column_name = 'customer_label' and data_type = 'text'
  ) then raise exception 'Schema draft did not add customer_label'; end if;

  if (select pronargdefaults from pg_proc where oid = 'public.pay_kitchen_order(uuid,public.payment_method,numeric)'::regprocedure) <> 1 then
    raise exception 'pay_kitchen_order default argument signature changed';
  end if;
  if (select proargnames[1:pronargs] from pg_proc where oid = 'public.pay_kitchen_order(uuid,public.payment_method,numeric)'::regprocedure)
    <> array['p_order_id', 'p_payment_method', 'p_discount'] then
    raise exception 'pay_kitchen_order argument names changed';
  end if;
  if (select pronargdefaults from pg_proc where oid = 'public.post_sale(uuid,uuid,public.payment_method,jsonb,numeric)'::regprocedure) <> 1 then
    raise exception 'post_sale default argument signature changed';
  end if;
  if (select proargnames[1:pronargs] from pg_proc where oid = 'public.post_sale(uuid,uuid,public.payment_method,jsonb,numeric)'::regprocedure)
    <> array['p_client_request_id', 'p_unit_id', 'p_payment_method', 'p_items', 'p_discount'] then
    raise exception 'post_sale argument names changed';
  end if;
end
$metadata_checks$;

insert into auth.users(id) values
  ('20000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002');

insert into public.business_units(id, code, name, kind)
values
  ('10000000-0000-0000-0000-000000000001', 'test-branch', 'Test Branch', 'branch'),
  ('10000000-0000-0000-0000-000000000002', 'other-branch', 'Other Branch', 'branch');

insert into public.user_profiles(user_id, role, unit_id)
values
  ('20000000-0000-0000-0000-000000000001', 'cashier', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', 'kitchen', '10000000-0000-0000-0000-000000000001');

insert into public.menu_items(id, name, sale_price)
values ('30000000-0000-0000-0000-000000000001', 'Fixture Menu', 100.00);

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', false);
set role authenticated;

do $create_checks$
declare
  v_result jsonb;
  v_retry jsonb;
  v_conflict_raised boolean := false;
  v_unit_denied boolean := false;
begin
  v_result := public.create_kitchen_order(
    '40000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'dine_in', 'T-1', null,
    '[{"menu_item_id":"30000000-0000-0000-0000-000000000001","quantity":2,"item_notes":"fixture"}]'::jsonb
  );
  if v_result->>'result' <> 'created' then raise exception 'Create did not return created'; end if;
  perform set_config('order_flow_test.root_id', v_result->>'order_id', false);
  if v_result->>'payment_status' <> 'unpaid' then raise exception 'New order must be unpaid'; end if;

  v_retry := public.create_kitchen_order(
    '40000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'dine_in', 'T-1', null,
    '[{"menu_item_id":"30000000-0000-0000-0000-000000000001","quantity":2,"item_notes":"fixture"}]'::jsonb
  );
  if v_retry->>'result' <> 'existing' or v_retry->>'order_id' <> v_result->>'order_id' then
    raise exception 'Identical create retry was not idempotent';
  end if;

  begin
    perform public.create_kitchen_order(
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      'dine_in', 'T-1', null,
      '[{"menu_item_id":"30000000-0000-0000-0000-000000000001","quantity":3,"item_notes":"fixture"}]'::jsonb
    );
  exception when others then
    if sqlerrm = 'IDEMPOTENCY_CONFLICT' then v_conflict_raised := true; else raise; end if;
  end;
  if not v_conflict_raised then raise exception 'Changed payload reused the idempotency key'; end if;

  begin
    perform public.create_kitchen_order(
      '40000000-0000-0000-0000-000000000004',
      '10000000-0000-0000-0000-000000000002',
      'dine_in', 'T-9', null,
      '[{"menu_item_id":"30000000-0000-0000-0000-000000000001","quantity":1,"item_notes":null}]'::jsonb
    );
  exception when others then
    if sqlerrm = 'UNIT_ACCESS_DENIED' then v_unit_denied := true; else raise; end if;
  end;
  if not v_unit_denied then raise exception 'Cashier could create an order for another unit'; end if;

  begin
    perform public.create_kitchen_order(
      '40000000-0000-0000-0000-000000000005',
      '10000000-0000-0000-0000-000000000001',
      'dine_in', 'T-2', null,
      '[{"menu_item_id":"30000000-0000-0000-0000-000000000001","quantity":1,"item_notes":null},{"menu_item_id":"30000000-0000-0000-0000-000000000099","quantity":1,"item_notes":null}]'::jsonb
    );
  exception when others then
    if sqlerrm = 'MENU_NOT_ACTIVE' then v_conflict_raised := true; else raise; end if;
  end;
  if not v_conflict_raised then raise exception 'Invalid item unexpectedly succeeded'; end if;

  v_result := public.create_kitchen_order(
    '40000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    'takeaway', null, 'Fixture Takeaway',
    '[{"menu_item_id":"30000000-0000-0000-0000-000000000001","quantity":1,"item_notes":null}]'::jsonb
  );
  if v_result->>'result' <> 'created' then raise exception 'Takeaway order was not created'; end if;
  perform set_config('order_flow_test.takeaway_id', v_result->>'order_id', false);
end
$create_checks$;

reset role;
do $create_row_checks$
begin
  if (select count(*) from public.kitchen_orders where client_request_id = '40000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'Create retry produced duplicate headers';
  end if;
  if exists (select 1 from public.kitchen_orders where client_request_id = '40000000-0000-0000-0000-000000000005') then
    raise exception 'Failed create left a partial order header';
  end if;
  if (select unit_price from public.kitchen_order_items where order_id = current_setting('order_flow_test.root_id')::uuid) <> 100.00 then
    raise exception 'Initial price snapshot is incorrect';
  end if;
  if (select table_number from public.kitchen_orders where id = current_setting('order_flow_test.takeaway_id')::uuid) is not null
    or (select customer_label from public.kitchen_orders where id = current_setting('order_flow_test.takeaway_id')::uuid) <> 'Fixture Takeaway' then
    raise exception 'Takeaway identity was not stored with a null table_number';
  end if;
end
$create_row_checks$;

update public.menu_items set sale_price = 125.00 where id = '30000000-0000-0000-0000-000000000001';
set role authenticated;

do $round_checks$
declare
  v_root uuid := current_setting('order_flow_test.root_id')::uuid;
  v_result jsonb;
  v_retry jsonb;
  v_conflict_raised boolean := false;
begin
  v_result := public.append_kitchen_round(
    '40000000-0000-0000-0000-000000000002', v_root,
    '[{"menu_item_id":"30000000-0000-0000-0000-000000000001","quantity":1,"item_notes":"second round"}]'::jsonb
  );
  if v_result->>'result' <> 'created' or (v_result->>'round_number')::integer <> 2 then
    raise exception 'Append did not create round 2';
  end if;
  perform set_config('order_flow_test.round_id', v_result->>'order_id', false);

  v_retry := public.append_kitchen_round(
    '40000000-0000-0000-0000-000000000002', v_root,
    '[{"menu_item_id":"30000000-0000-0000-0000-000000000001","quantity":1,"item_notes":"second round"}]'::jsonb
  );
  if v_retry->>'result' <> 'existing' or v_retry->>'order_id' <> v_result->>'order_id' then
    raise exception 'Identical append retry was not idempotent';
  end if;
  begin
    perform public.append_kitchen_round(
      '40000000-0000-0000-0000-000000000002', v_root,
      '[{"menu_item_id":"30000000-0000-0000-0000-000000000001","quantity":2,"item_notes":"different"}]'::jsonb
    );
  exception when others then
    if sqlerrm = 'IDEMPOTENCY_CONFLICT' then v_conflict_raised := true; else raise; end if;
  end;
  if not v_conflict_raised then raise exception 'Changed append reused the idempotency key'; end if;

  v_conflict_raised := false;
  begin
    perform public.append_kitchen_round(
      '40000000-0000-0000-0000-000000000006', v_root,
      '[{"menu_item_id":"30000000-0000-0000-0000-000000000001","quantity":1,"item_notes":null},{"menu_item_id":"30000000-0000-0000-0000-000000000099","quantity":1,"item_notes":null}]'::jsonb
    );
  exception when others then
    if sqlerrm = 'MENU_NOT_ACTIVE' then v_conflict_raised := true; else raise; end if;
  end;
  if not v_conflict_raised then raise exception 'Invalid append item unexpectedly succeeded'; end if;
end
$round_checks$;

reset role;
do $round_row_checks$
declare
  v_root uuid := current_setting('order_flow_test.root_id')::uuid;
  v_round uuid := current_setting('order_flow_test.round_id')::uuid;
begin
  if (select unit_price from public.kitchen_order_items where order_id = v_round) <> 125.00 then
    raise exception 'Append did not snapshot the current menu price';
  end if;
  if (select count(*) from public.kitchen_orders where parent_order_id = v_root) <> 1 then
    raise exception 'Append retry or failed append changed round count';
  end if;
  perform set_config('order_flow_test.item_id', (
    select id::text from public.kitchen_order_items where order_id = v_root limit 1
  ), false);
end
$round_row_checks$;

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', false);
set role authenticated;

do $kitchen_checks$
declare
  v_root uuid := current_setting('order_flow_test.root_id')::uuid;
  v_item uuid := current_setting('order_flow_test.item_id')::uuid;
  v_result jsonb;
  v_order_count integer;
begin
  v_result := public.set_kitchen_item_preparation(v_item, 'preparing');
  if v_result->>'result' <> 'updated' then raise exception 'queued -> preparing failed'; end if;
  v_result := public.set_kitchen_item_preparation(v_item, 'ready');
  if v_result->>'result' <> 'updated' then raise exception 'preparing -> ready failed'; end if;
  v_result := public.set_kitchen_item_preparation(v_item, 'ready');
  if v_result->>'result' <> 'existing' then raise exception 'Same-status retry was not idempotent'; end if;
  select count(*) into v_order_count
  from public.list_kitchen_orders('10000000-0000-0000-0000-000000000001');
  if v_order_count <> 3 then raise exception 'Queue list did not return all unpaid fixture orders and rounds'; end if;

  if not exists (
    select 1 from public.list_kitchen_orders('10000000-0000-0000-0000-000000000001') q
    cross join lateral jsonb_array_elements(q.items) i
    where q.order_id = v_root
      and i->>'menu_name_snapshot' = 'Fixture Menu'
      and (i->>'quantity')::numeric = 2
      and (i->>'unit_price')::numeric = 100
      and (i->>'line_total')::numeric = 200
      and i->>'item_notes' = 'fixture'
      and i->>'preparation_status' = 'ready'
      and i->>'is_prepared' = 'true'
  ) then raise exception 'Queue RPC item payload differs from cashier/kitchen client contract'; end if;
end
$kitchen_checks$;

reset role;

do $kitchen_row_checks$
declare
  v_item uuid := current_setting('order_flow_test.item_id')::uuid;
begin
  if not (select is_prepared from public.kitchen_order_items where id = v_item) then
    raise exception 'is_prepared was not synchronized with ready status';
  end if;
  if (select preparation_status from public.kitchen_order_items where id = v_item) <> 'ready' then
    raise exception 'Item preparation status was not persisted';
  end if;
end
$kitchen_row_checks$;

do $protected_function_checks$
declare
  v_signature text;
  v_oid oid;
  v_expected text;
begin
  foreach v_signature in array array[
    'public.pay_kitchen_order(uuid,public.payment_method,numeric)',
    'public.post_sale(uuid,uuid,public.payment_method,jsonb,numeric)'
  ] loop
    v_oid := to_regprocedure(v_signature);
    if v_oid is null then raise exception 'Protected function missing: %', v_signature; end if;
    select definition into v_expected from order_flow_test.protected_function_definitions
    where signature = v_oid::regprocedure::text;
    if v_expected is null or pg_get_functiondef(v_oid) is distinct from v_expected then
      raise exception 'Protected function definition changed: %', v_signature;
    end if;
  end loop;
end
$protected_function_checks$;

select 'Order flow disposable PostgreSQL assertions passed' as result;
