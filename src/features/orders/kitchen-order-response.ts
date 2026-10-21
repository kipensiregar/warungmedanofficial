import type { KitchenPaymentResult, KitchenQueueOrder } from './kitchen-order-api'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const rpcErrorMessages: Record<string, string> = {
  IDEMPOTENCY_CONFLICT: 'Permintaan dengan kunci ini sudah dipakai untuk isi berbeda. Muat ulang order sebelum mencoba lagi.',
  UNIT_ACCESS_DENIED: 'Anda tidak memiliki akses ke unit order ini.',
  UNIT_KIND_MISMATCH: 'Role pengguna tidak sesuai dengan jenis unit usaha.',
  UNIT_NOT_ACTIVE: 'Unit usaha tidak aktif atau tidak tersedia.',
  ORDER_CLOSED: 'Order sudah ditutup dan tidak dapat diubah.',
  ORDER_HAS_CANCELLED_ROUND: 'Pembayaran ditolak karena ada round yang dibatalkan.',
  INVALID_STATUS_TRANSITION: 'Perubahan status item tidak diizinkan.',
  INVALID_QUANTITY: 'Kuantitas item tidak valid.',
  MENU_NOT_ACTIVE: 'Salah satu menu tidak lagi aktif. Muat ulang menu.',
  ORDER_NOT_FOUND: 'Order aktif tidak ditemukan. Muat ulang daftar order.',
  INVALID_STATUS: 'Status persiapan yang diminta tidak valid.',
}

export function safeKitchenRpcError(message: string, fallback: string) {
  const knownCode = Object.keys(rpcErrorMessages).find(code => message === code || message.startsWith(`${code}:`) || message.startsWith(`${code} `))
  return new Error(knownCode ? rpcErrorMessages[knownCode] : fallback)
}

export function parseKitchenPaymentResult(data: unknown): KitchenPaymentResult {
  if (
    !isRecord(data) ||
    (data.status !== 'paid' && data.status !== 'already_paid') ||
    typeof data.order_id !== 'string' ||
    typeof data.sale_id !== 'string'
  ) {
    throw new Error('Respons pay_kitchen_order tidak sesuai kontrak yang diketahui.')
  }

  return data as KitchenPaymentResult
}

export function assertKitchenOrderInput(input: {
  requestId: string
  unitId?: string
  rootOrderId?: string
  serviceType?: 'dine_in' | 'takeaway'
  tableNumber?: string | null
  items: { menu_item_id: string; quantity: number; item_notes: string | null }[]
}) {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidPattern.test(input.requestId)) throw new Error('ID permintaan order tidak valid.')
  if (input.unitId !== undefined && !uuidPattern.test(input.unitId)) throw new Error('Unit order tidak valid.')
  if (input.rootOrderId !== undefined && !uuidPattern.test(input.rootOrderId)) throw new Error('Order induk tidak valid.')
  if (input.items.length < 1 || input.items.length > 100) throw new Error('Order harus berisi 1 sampai 100 item.')
  for (const item of input.items) {
    if (!uuidPattern.test(item.menu_item_id)) throw new Error('ID menu tidak valid.')
    if (!Number.isInteger(item.quantity) || item.quantity < 1) throw new Error('Kuantitas harus bilangan bulat positif.')
    if (item.item_notes !== null && item.item_notes.length > 300) throw new Error('Catatan item maksimal 300 karakter.')
  }
  if (input.serviceType === 'dine_in' && !input.tableNumber?.trim()) throw new Error('Nomor meja wajib diisi.')
  if (input.serviceType === 'dine_in' && (input.tableNumber?.length ?? 0) > 40) throw new Error('Nomor meja maksimal 40 karakter.')
  if (input.serviceType === 'takeaway' && input.tableNumber && input.tableNumber.length > 80) throw new Error('Identitas takeaway maksimal 80 karakter.')
}

export function parseKitchenOrderResult(data: unknown, allowedResults: readonly string[]) {
  if (
    !isRecord(data) ||
    data.ok !== true ||
    typeof data.result !== 'string' ||
    !allowedResults.includes(data.result) ||
    typeof data.order_id !== 'string'
  ) {
    throw new Error('Respons RPC order tidak sesuai kontrak lokal.')
  }
  return data as {
    ok: true
    result: 'created' | 'existing' | 'updated' | 'paid'
    order_id: string
    root_order_id?: string
    sale_id?: string
    order_number?: number
    round_number?: number
    payment_status?: 'unpaid' | 'paid' | 'cancelled'
    subtotal?: number
    total?: number
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function parseKitchenQueue(data: unknown) {
  if (!Array.isArray(data)) throw new Error('Respons antrean dapur tidak berbentuk daftar.')
  for (const order of data) {
    if (!isRecord(order) || typeof order.order_id !== 'string' || typeof order.root_order_id !== 'string' || !Array.isArray(order.items)) {
      throw new Error('Respons antrean dapur tidak sesuai kontrak lokal.')
    }
    if (order.service_type !== 'dine_in' && order.service_type !== 'takeaway') throw new Error('Jenis layanan order tidak dikenal.')
    if (!['queued', 'preparing', 'ready', 'served', 'cancelled'].includes(String(order.status))) throw new Error('Status order tidak dikenal.')
    if (!['unpaid', 'paid', 'cancelled'].includes(String(order.payment_status))) throw new Error('Status pembayaran tidak dikenal.')
    if (!isFiniteNumber(order.subtotal) || !isFiniteNumber(order.total)) throw new Error('Total order tidak valid.')
    if (!isFiniteNumber(order.order_number) || !isFiniteNumber(order.round_number) || typeof order.unit_id !== 'string' || typeof order.created_at !== 'string') {
      throw new Error('Metadata antrean order tidak sesuai kontrak lokal.')
    }
    for (const item of order.items) {
      if (!isRecord(item) || typeof item.id !== 'string' || typeof item.menu_name_snapshot !== 'string') throw new Error('Item antrean tidak sesuai kontrak lokal.')
      if (!['queued', 'preparing', 'ready'].includes(String(item.preparation_status))) throw new Error('Status persiapan item tidak dikenal.')
      if (!isFiniteNumber(item.quantity) || !isFiniteNumber(item.unit_price) || !isFiniteNumber(item.line_total)) throw new Error('Nilai item antrean tidak valid.')
    }
  }
  return data
}

export function getAppendableKitchenRoots(orders: KitchenQueueOrder[]) {
  const cancelledRoots = new Set(orders.filter(order => order.status === 'cancelled').map(order => order.root_order_id))
  return orders.filter(order =>
    order.parent_order_id === null &&
    order.payment_status === 'unpaid' &&
    !cancelledRoots.has(order.root_order_id),
  )
}
