-- REVIEW ONLY; not in the normal Supabase migration directory.
-- Depends on 20261021_order_flow_schema_prerequisites.sql and a verified active
-- schema/policy/trigger/grant baseline. DO NOT RUN against PRODUCTION.
-- Payment is intentionally excluded: the active pay_kitchen_order function is
-- retained unchanged. This file only adds create/append/list/item-status RPCs.

begin;

do $rpc_preflight$
begin
  if to_regprocedure('public.create_kitchen_order(uuid,uuid,text,text,text,jsonb)') is not null
    or to_regprocedure('public.append_kitchen_round(uuid,uuid,jsonb)') is not null
    or to_regprocedure('public.set_kitchen_item_preparation(uuid,text)') is not null
    or to_regprocedure('public.list_kitchen_orders(uuid)') is not null then
    raise exception 'An order-flow RPC already exists; inspect and reconcile it before applying this draft';
  end if;
end
$rpc_preflight$;

create or replace function public.create_kitchen_order(
  p_request_id uuid,
  p_unit_id uuid,
  p_service_type text,
  p_table_number text,
  p_customer_label text,
  p_items jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_profile_unit uuid;
  v_unit_kind text;
  v_hash text;
  v_order_id uuid;
  v_order_number bigint;
  v_existing_hash text;
  v_item jsonb;
  v_menu_id uuid;
  v_quantity numeric;
  v_price numeric(14,2);
  v_name text;
  v_line numeric(14,2);
  v_subtotal numeric(14,2) := 0;
begin
  if v_user is null or p_request_id is null then raise exception 'AUTH_OR_REQUEST_REQUIRED'; end if;
  select p.role::text, p.unit_id into v_role, v_profile_unit
  from public.user_profiles p where p.user_id = v_user and p.is_active;
  if v_role is null then raise exception 'INACTIVE_PROFILE'; end if;
  if v_role not in ('owner','cashier','tenant') then raise exception 'ROLE_NOT_ALLOWED'; end if;
  if v_role <> 'owner' and v_profile_unit is distinct from p_unit_id then raise exception 'UNIT_ACCESS_DENIED'; end if;
  select u.kind::text into v_unit_kind from public.business_units u
  where u.id = p_unit_id and u.is_active;
  if v_unit_kind is null then raise exception 'UNIT_NOT_ACTIVE'; end if;
  if (v_role = 'cashier' and v_unit_kind <> 'branch') or (v_role = 'tenant' and v_unit_kind <> 'bazaar') then
    raise exception 'UNIT_KIND_MISMATCH';
  end if;
  if p_service_type is null or p_service_type not in ('dine_in','takeaway')
    or length(coalesce(p_table_number,'')) > 40
    or (p_service_type = 'dine_in' and nullif(trim(p_table_number),'') is null)
    or (p_service_type = 'dine_in' and p_customer_label is not null)
    or (p_service_type = 'takeaway' and p_table_number is not null)
    or length(coalesce(p_customer_label,'')) > 80 then
    raise exception 'INVALID_PAYLOAD';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'INVALID_PAYLOAD'; end if;
  if jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>100 then raise exception 'INVALID_PAYLOAD'; end if;
  v_hash := md5(jsonb_build_object('unit_id',p_unit_id,'service_type',p_service_type,
    'table_number',nullif(trim(p_table_number),''),
    'customer_label',nullif(trim(p_customer_label),''),'items',p_items)::text);
  select o.id,o.order_number,o.request_payload_hash into v_order_id,v_order_number,v_existing_hash
  from public.kitchen_orders o where o.client_request_id = p_request_id;
  if v_order_id is not null then
    if v_existing_hash is distinct from v_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('ok',true,'result','existing','order_id',v_order_id,'order_number',v_order_number);
  end if;
  insert into public.kitchen_orders(client_request_id,request_payload_hash,unit_id,created_by,
    service_type,table_number,customer_label,status,payment_status,subtotal,discount,total,parent_order_id,round_number)
  values(p_request_id,v_hash,p_unit_id,v_user,p_service_type,nullif(trim(p_table_number),''),
    nullif(trim(p_customer_label),''),
    'queued','unpaid',0,0,0,null,1)
  on conflict (client_request_id) do nothing
  returning id,order_number into v_order_id,v_order_number;
  if v_order_id is null then
    select o.id,o.order_number,o.request_payload_hash into v_order_id,v_order_number,v_existing_hash
    from public.kitchen_orders o where o.client_request_id = p_request_id;
    if v_existing_hash is distinct from v_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('ok',true,'result','existing','order_id',v_order_id,'order_number',v_order_number);
  end if;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_menu_id := (v_item->>'menu_item_id')::uuid;
      v_quantity := (v_item->>'quantity')::numeric;
    exception when others then raise exception 'INVALID_ITEM'; end;
    if v_quantity is null or v_quantity <= 0 or v_quantity <> trunc(v_quantity) then raise exception 'INVALID_QUANTITY'; end if;
    if length(coalesce(v_item->>'item_notes','')) > 300 then raise exception 'INVALID_ITEM_NOTES'; end if;
    select m.name,m.sale_price into v_name,v_price from public.menu_items m
    where m.id = v_menu_id and m.is_active for share;
    if v_name is null then raise exception 'MENU_NOT_ACTIVE'; end if;
    v_line := round(v_quantity * v_price,2);
    v_subtotal := v_subtotal + v_line;
    insert into public.kitchen_order_items(order_id,menu_item_id,menu_name_snapshot,quantity,
      unit_price,line_total,item_notes,is_prepared,preparation_status)
    values(v_order_id,v_menu_id,v_name,v_quantity,v_price,v_line,
      nullif(v_item->>'item_notes',''),false,'queued');
  end loop;
  update public.kitchen_orders set subtotal=v_subtotal,total=v_subtotal,updated_at=now()
  where id=v_order_id;
  return jsonb_build_object('ok',true,'result','created','order_id',v_order_id,
    'order_number',v_order_number,'round_number',1,'payment_status','unpaid','subtotal',v_subtotal,'total',v_subtotal);
end
$function$;

create or replace function public.append_kitchen_round(
  p_request_id uuid,
  p_root_order_id uuid,
  p_items jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_profile_unit uuid;
  v_unit_kind text;
  v_root public.kitchen_orders%rowtype;
  v_hash text;
  v_order_id uuid;
  v_order_number bigint;
  v_round integer;
  v_existing_hash text;
  v_item jsonb;
  v_menu_id uuid;
  v_quantity numeric;
  v_price numeric(14,2);
  v_name text;
  v_line numeric(14,2);
  v_subtotal numeric(14,2) := 0;
begin
  if v_user is null or p_request_id is null or p_root_order_id is null then raise exception 'AUTH_OR_REQUEST_REQUIRED'; end if;
  select p.role::text,p.unit_id into v_role,v_profile_unit
  from public.user_profiles p where p.user_id=v_user and p.is_active;
  if v_role is null then raise exception 'INACTIVE_PROFILE'; end if;
  if v_role not in ('owner','cashier','tenant') then raise exception 'ROLE_NOT_ALLOWED'; end if;
  select o.* into v_root from public.kitchen_orders o
  where o.id=coalesce((select x.parent_order_id from public.kitchen_orders x where x.id=p_root_order_id),p_root_order_id)
    for update;
  if v_root.id is null or v_root.parent_order_id is not null then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_role <> 'owner' and v_profile_unit is distinct from v_root.unit_id then raise exception 'UNIT_ACCESS_DENIED'; end if;
  if exists(select 1 from public.kitchen_orders o where (o.id=v_root.id or o.parent_order_id=v_root.id)
    and o.unit_id is distinct from v_root.unit_id) then raise exception 'INTEGRITY_ERROR'; end if;
  select u.kind::text into v_unit_kind from public.business_units u where u.id=v_root.unit_id and u.is_active;
  if v_unit_kind is null then raise exception 'UNIT_NOT_ACTIVE'; end if;
  if (v_role='cashier' and v_unit_kind<>'branch') or (v_role='tenant' and v_unit_kind<>'bazaar') then
    raise exception 'UNIT_KIND_MISMATCH';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'INVALID_PAYLOAD'; end if;
  if jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>100 then raise exception 'INVALID_PAYLOAD'; end if;
  v_hash := md5(jsonb_build_object('root_order_id',v_root.id,'items',p_items)::text);
  select o.id,o.order_number,o.request_payload_hash,o.round_number into v_order_id,v_order_number,v_existing_hash,v_round
  from public.kitchen_orders o where o.client_request_id=p_request_id;
  if v_order_id is not null then
    if v_existing_hash is distinct from v_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('ok',true,'result','existing','order_id',v_order_id,'order_number',v_order_number,'round_number',v_round);
  end if;
  if v_root.payment_status <> 'unpaid' or v_root.status='cancelled' then raise exception 'ORDER_CLOSED'; end if;
  if exists(select 1 from public.kitchen_orders o where (o.id=v_root.id or o.parent_order_id=v_root.id)
    and o.status='cancelled') then raise exception 'ORDER_HAS_CANCELLED_ROUND'; end if;
  v_round := (select coalesce(max(o.round_number),0)+1 from public.kitchen_orders o
    where o.id=v_root.id or o.parent_order_id=v_root.id);
  insert into public.kitchen_orders(client_request_id,request_payload_hash,unit_id,created_by,
    service_type,table_number,customer_label,status,payment_status,subtotal,discount,total,parent_order_id,round_number)
  values(p_request_id,v_hash,v_root.unit_id,v_user,v_root.service_type,v_root.table_number,v_root.customer_label,
    'queued','unpaid',0,0,0,v_root.id,v_round)
  on conflict(client_request_id) do nothing returning id,order_number into v_order_id,v_order_number;
  if v_order_id is null then
    select o.id,o.order_number,o.request_payload_hash,o.round_number into v_order_id,v_order_number,v_existing_hash,v_round
    from public.kitchen_orders o where o.client_request_id=p_request_id;
    if v_existing_hash is distinct from v_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('ok',true,'result','existing','order_id',v_order_id,'order_number',v_order_number,'round_number',v_round);
  end if;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin v_menu_id := (v_item->>'menu_item_id')::uuid; v_quantity := (v_item->>'quantity')::numeric;
    exception when others then raise exception 'INVALID_ITEM'; end;
    if v_quantity is null or v_quantity<=0 or v_quantity<>trunc(v_quantity) then raise exception 'INVALID_QUANTITY'; end if;
    if length(coalesce(v_item->>'item_notes','')) > 300 then raise exception 'INVALID_ITEM_NOTES'; end if;
    select m.name,m.sale_price into v_name,v_price from public.menu_items m
      where m.id=v_menu_id and m.is_active for share;
    if v_name is null then raise exception 'MENU_NOT_ACTIVE'; end if;
    v_line:=round(v_quantity*v_price,2); v_subtotal:=v_subtotal+v_line;
    insert into public.kitchen_order_items(order_id,menu_item_id,menu_name_snapshot,quantity,
      unit_price,line_total,item_notes,is_prepared,preparation_status)
    values(v_order_id,v_menu_id,v_name,v_quantity,v_price,v_line,
      nullif(v_item->>'item_notes',''),false,'queued');
  end loop;
  update public.kitchen_orders set subtotal=v_subtotal,total=v_subtotal,updated_at=now() where id=v_order_id;
  return jsonb_build_object('ok',true,'result','created','order_id',v_order_id,'root_order_id',v_root.id,
    'order_number',v_order_number,'round_number',v_round,'payment_status','unpaid','subtotal',v_subtotal,'total',v_subtotal);
end
$function$;

create or replace function public.set_kitchen_item_preparation(p_item_id uuid,p_target_status text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_user uuid:=auth.uid(); v_role text; v_unit uuid; v_order public.kitchen_orders%rowtype; v_old text;
begin
  select p.role::text,p.unit_id into v_role,v_unit from public.user_profiles p
    where p.user_id=v_user and p.is_active;
  if v_user is null or v_role is null then raise exception 'INACTIVE_PROFILE'; end if;
  if v_role not in ('owner','kitchen') then raise exception 'ROLE_NOT_ALLOWED'; end if;
  if p_target_status is null or p_target_status not in ('queued','preparing','ready') then raise exception 'INVALID_STATUS'; end if;
  select o.* into v_order from public.kitchen_orders o join public.kitchen_order_items i on i.order_id=o.id
    where i.id=p_item_id for update of o,i;
  if v_order.id is null then raise exception 'ITEM_NOT_FOUND'; end if;
  if v_role='kitchen' and v_unit is distinct from v_order.unit_id then raise exception 'UNIT_ACCESS_DENIED'; end if;
  if v_order.status='cancelled' or v_order.payment_status='cancelled' then raise exception 'ORDER_CLOSED'; end if;
  select i.preparation_status into v_old from public.kitchen_order_items i where i.id=p_item_id;
  if p_target_status=v_old then return jsonb_build_object('ok',true,'result','existing','order_id',v_order.id); end if;
  if not ((v_old='queued' and p_target_status='preparing') or (v_old='preparing' and p_target_status='ready')) then
    raise exception 'INVALID_STATUS_TRANSITION';
  end if;
  update public.kitchen_order_items set preparation_status=p_target_status,is_prepared=(p_target_status='ready') where id=p_item_id;
  insert into public.audit_logs(actor_user_id,unit_id,action,entity_type,entity_id,details)
  values(v_user,v_order.unit_id,'kitchen_item_preparation_changed','kitchen_order_item',p_item_id::text,
    jsonb_build_object('order_id',v_order.id,'from',v_old,'to',p_target_status));
  return jsonb_build_object('ok',true,'result','updated','order_id',v_order.id,'payment_status',v_order.payment_status);
end
$function$;

create or replace function public.list_kitchen_orders(p_unit_id uuid)
returns table(order_id uuid,root_order_id uuid,order_number bigint,unit_id uuid,service_type text,
  table_number text,customer_label text,status text,payment_status text,subtotal numeric,total numeric,parent_order_id uuid,
  round_number integer,created_at timestamptz,items jsonb)
language plpgsql stable security definer set search_path = ''
as $function$
declare v_user uuid:=auth.uid(); v_role text; v_unit uuid; v_unit_kind text;
begin
  select p.role::text,p.unit_id into v_role,v_unit from public.user_profiles p where p.user_id=v_user and p.is_active;
  if v_user is null or v_role is null then raise exception 'INACTIVE_PROFILE'; end if;
  if v_role not in ('owner','cashier','tenant','kitchen') then raise exception 'ROLE_NOT_ALLOWED'; end if;
  if v_role <> 'owner' and v_unit is distinct from p_unit_id then raise exception 'UNIT_ACCESS_DENIED'; end if;
  select u.kind::text into v_unit_kind from public.business_units u where u.id=p_unit_id and u.is_active;
  if v_unit_kind is null then raise exception 'UNIT_NOT_ACTIVE'; end if;
  if (v_role='cashier' and v_unit_kind<>'branch') or (v_role='tenant' and v_unit_kind<>'bazaar') then
    raise exception 'UNIT_KIND_MISMATCH';
  end if;
  return query
  select o.id,coalesce(o.parent_order_id,o.id),o.order_number,o.unit_id,o.service_type,o.table_number,o.customer_label,
    o.status,o.payment_status,o.subtotal,o.total,o.parent_order_id,o.round_number,o.created_at,
    coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'menu_item_id',i.menu_item_id,
      'menu_name_snapshot',i.menu_name_snapshot,'quantity',i.quantity,'unit_price',i.unit_price,
      'line_total',i.line_total,'item_notes',i.item_notes,'preparation_status',i.preparation_status,
      'is_prepared',i.is_prepared) order by i.id) from public.kitchen_order_items i where i.order_id=o.id),'[]'::jsonb)
  from public.kitchen_orders o where o.unit_id=p_unit_id and o.payment_status='unpaid'
  order by o.created_at,o.round_number;
end
$function$;

alter function public.create_kitchen_order(uuid,uuid,text,text,text,jsonb) owner to postgres;
alter function public.append_kitchen_round(uuid,uuid,jsonb) owner to postgres;
alter function public.set_kitchen_item_preparation(uuid,text) owner to postgres;
alter function public.list_kitchen_orders(uuid) owner to postgres;
revoke all on function public.create_kitchen_order(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.append_kitchen_round(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.set_kitchen_item_preparation(uuid,text) from public,anon,authenticated;
revoke all on function public.list_kitchen_orders(uuid) from public,anon,authenticated;

commit;

-- Manual rollback (review only; never run before revoking EXECUTE in the
-- permissions draft and stopping callers). Drop in reverse creation order:
-- DROP FUNCTION public.list_kitchen_orders(uuid);
-- DROP FUNCTION public.set_kitchen_item_preparation(uuid,text);
-- DROP FUNCTION public.append_kitchen_round(uuid,uuid,jsonb);
-- DROP FUNCTION public.create_kitchen_order(uuid,uuid,text,text,text,jsonb);
-- These drops remove only the four new RPCs. They do not touch
-- public.pay_kitchen_order or public.post_sale.
