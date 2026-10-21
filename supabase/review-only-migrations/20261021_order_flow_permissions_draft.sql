-- REVIEW ONLY; apply only after schema and RPC definitions have been reviewed.
-- Requires all four exact public RPC signatures to exist.
-- This file changes EXECUTE permissions only. It does not change RLS or table grants.
-- DO NOT RUN against PRODUCTION without explicit approval.

begin;

do $permission_preflight$
begin
  if to_regprocedure('public.create_kitchen_order(uuid,uuid,text,text,text,jsonb)') is null
    or to_regprocedure('public.append_kitchen_round(uuid,uuid,jsonb)') is null
    or to_regprocedure('public.set_kitchen_item_preparation(uuid,text)') is null
    or to_regprocedure('public.list_kitchen_orders(uuid)') is null then
    raise exception 'Apply and review all four order RPC definitions before granting EXECUTE';
  end if;
end
$permission_preflight$;

grant execute on function public.create_kitchen_order(uuid,uuid,text,text,text,jsonb) to authenticated;
grant execute on function public.append_kitchen_round(uuid,uuid,jsonb) to authenticated;
grant execute on function public.set_kitchen_item_preparation(uuid,text) to authenticated;
grant execute on function public.list_kitchen_orders(uuid) to authenticated;

commit;

-- Rollback permissions only:
-- REVOKE EXECUTE ON FUNCTION public.create_kitchen_order(uuid,uuid,text,text,text,jsonb) FROM authenticated;
-- REVOKE EXECUTE ON FUNCTION public.append_kitchen_round(uuid,uuid,jsonb) FROM authenticated;
-- REVOKE EXECUTE ON FUNCTION public.set_kitchen_item_preparation(uuid,text) FROM authenticated;
-- REVOKE EXECUTE ON FUNCTION public.list_kitchen_orders(uuid) FROM authenticated;
