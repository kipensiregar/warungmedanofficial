import { supabase } from '../../lib/supabase'
import { assertKitchenOrderInput, parseKitchenOrderResult, parseKitchenPaymentResult, parseKitchenQueue, safeKitchenRpcError } from './kitchen-order-response'

export type KitchenOrderLineInput = {
  menu_item_id: string
  quantity: number
  item_notes: string | null
}

export type KitchenOrderResult = {
  ok: true
  result: 'created' | 'existing' | 'updated' | 'paid'
  order_id?: string
  root_order_id?: string
  sale_id?: string
  order_number?: number
  round_number?: number
  payment_status?: 'unpaid' | 'paid' | 'cancelled'
  subtotal?: number
  total?: number
}

export type KitchenPaymentResult = {
  status: 'paid' | 'already_paid'
  order_id: string
  sale_id: string
  round_count?: number
  subtotal?: number
  discount?: number
  total?: number
}

export type KitchenQueueItem = {
  id: string
  menu_item_id: string
  menu_name_snapshot: string
  quantity: number
  unit_price: number
  line_total: number
  item_notes: string | null
  preparation_status: 'queued' | 'preparing' | 'ready'
  is_prepared: boolean
}

export type KitchenQueueOrder = {
  order_id: string
  root_order_id: string
  order_number: number
  unit_id: string
  service_type: 'dine_in' | 'takeaway'
  table_number: string | null
  customer_label: string | null
  status: 'queued' | 'preparing' | 'ready' | 'served' | 'cancelled'
  payment_status: 'unpaid' | 'paid' | 'cancelled'
  subtotal: number
  total: number
  parent_order_id: string | null
  round_number: number
  created_at: string
  items: KitchenQueueItem[]
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase belum dikonfigurasi.')
  return supabase
}

// Endpoints are intentionally not called by the UI until the production definitions,
// grants, and unit-scoped access have been reviewed and the local migration is approved.
export async function createKitchenOrder(input: {
  requestId: string
  unitId: string
  serviceType: 'dine_in' | 'takeaway'
  tableNumber: string | null
  items: KitchenOrderLineInput[]
}) {
  assertKitchenOrderInput({ ...input, serviceType: input.serviceType })
  const client = requireSupabase()
  const { data, error } = await client.rpc('create_kitchen_order', {
    p_request_id: input.requestId,
    p_unit_id: input.unitId,
    p_service_type: input.serviceType,
    p_table_number: input.serviceType === 'dine_in' ? input.tableNumber : null,
    p_customer_label: input.serviceType === 'takeaway' ? input.tableNumber : null,
    p_items: input.items,
  })
  if (error) throw safeKitchenRpcError(error.message, 'Order belum dapat dikirim. Periksa koneksi dan status order sebelum mencoba ulang.')
  return parseKitchenOrderResult(data, ['created', 'existing'])
}

export async function appendKitchenRound(input: {
  requestId: string
  rootOrderId: string
  items: KitchenOrderLineInput[]
}) {
  assertKitchenOrderInput(input)
  const client = requireSupabase()
  const { data, error } = await client.rpc('append_kitchen_round', {
    p_request_id: input.requestId,
    p_root_order_id: input.rootOrderId,
    p_items: input.items,
  })
  if (error) throw safeKitchenRpcError(error.message, 'Pesanan susulan belum dapat dikirim. Periksa status order sebelum mencoba ulang.')
  return parseKitchenOrderResult(data, ['created', 'existing'])
}

export async function listKitchenQueue(unitId: string) {
  const client = requireSupabase()
  const { data, error } = await client.rpc('list_kitchen_orders', { p_unit_id: unitId })
  if (error) throw safeKitchenRpcError(error.message, 'Antrean dapur belum dapat dimuat.')
  return parseKitchenQueue(data) as KitchenQueueOrder[]
}

export async function setKitchenItemPreparation(itemId: string, status: KitchenQueueItem['preparation_status']) {
  const client = requireSupabase()
  const { data, error } = await client.rpc('set_kitchen_item_preparation', {
    p_item_id: itemId,
    p_target_status: status,
  })
  if (error) throw safeKitchenRpcError(error.message, 'Status persiapan belum dapat diperbarui.')
  return parseKitchenOrderResult(data, ['existing', 'updated'])
}

export async function payKitchenOrder(rootOrderId: string, paymentMethod: 'cash' | 'bank_transfer' | 'qris' | 'debit' | 'other') {
  const client = requireSupabase()
  const { data, error } = await client.rpc('pay_kitchen_order', {
    p_order_id: rootOrderId,
    p_payment_method: paymentMethod,
  })
  if (error) throw safeKitchenRpcError(error.message, 'Pembayaran belum terkonfirmasi. Muat ulang status order sebelum mencoba lagi.')
  return parseKitchenPaymentResult(data)
}
