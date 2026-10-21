import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertKitchenOrderInput,
  getAppendableKitchenRoots,
  parseKitchenOrderResult,
  parseKitchenPaymentResult,
  parseKitchenQueue,
  safeKitchenRpcError,
} from '../src/features/orders/kitchen-order-response.ts'

test('accepts the active payment RPC response, including idempotent retry', () => {
  assert.deepEqual(
    parseKitchenPaymentResult({ status: 'already_paid', order_id: 'order-1', sale_id: 'sale-1' }),
    { status: 'already_paid', order_id: 'order-1', sale_id: 'sale-1' },
  )
})

test('rejects an unexpected payment RPC response shape', () => {
  assert.throws(
    () => parseKitchenPaymentResult({ ok: true, result: 'paid' }),
    /tidak sesuai kontrak/,
  )
})

test('validates order item input before calling an RPC', () => {
  assert.doesNotThrow(() => assertKitchenOrderInput({
    requestId: '00000000-0000-4000-8000-000000000001',
    unitId: '00000000-0000-4000-8000-000000000002',
    serviceType: 'dine_in',
    tableNumber: 'A1',
    items: [{ menu_item_id: '00000000-0000-4000-8000-000000000003', quantity: 2, item_notes: null }],
  }))
  assert.throws(() => assertKitchenOrderInput({
    requestId: '00000000-0000-4000-8000-000000000001',
    rootOrderId: '00000000-0000-4000-8000-000000000004',
    items: [{ menu_item_id: '00000000-0000-4000-8000-000000000003', quantity: 0, item_notes: null }],
  }), /bilangan bulat positif/)
  assert.throws(() => assertKitchenOrderInput({
    requestId: '00000000-0000-4000-8000-000000000001',
    unitId: '00000000-0000-4000-8000-000000000002',
    serviceType: 'dine_in',
    tableNumber: 'x'.repeat(41),
    items: [{ menu_item_id: '00000000-0000-4000-8000-000000000003', quantity: 1, item_notes: null }],
  }), /Nomor meja maksimal/)
})

test('accepts known order and queue response envelopes and rejects malformed data', () => {
  assert.equal(parseKitchenOrderResult({ ok: true, result: 'created', order_id: 'order-1' }, ['created']).order_id, 'order-1')
  assert.throws(() => parseKitchenOrderResult({ ok: false }, ['created']), /tidak sesuai/)
  assert.deepEqual(parseKitchenQueue([]), [])
  assert.throws(() => parseKitchenQueue({ rows: [] }), /tidak berbentuk daftar/)
})

test('maps known RPC errors and hides unrecognized database details', () => {
  assert.match(safeKitchenRpcError('IDEMPOTENCY_CONFLICT', 'fallback').message, /kunci ini sudah dipakai/)
  assert.equal(safeKitchenRpcError('column private_schema.secret does not exist', 'fallback aman').message, 'fallback aman')
})

test('does not offer a root order for append when any round is cancelled', () => {
  const root = { order_id: 'root-1', root_order_id: 'root-1', parent_order_id: null, payment_status: 'unpaid', status: 'queued' }
  const cancelledRound = { order_id: 'round-2', root_order_id: 'root-1', parent_order_id: 'root-1', payment_status: 'unpaid', status: 'cancelled' }
  assert.deepEqual(getAppendableKitchenRoots([root, cancelledRound]), [])
  assert.deepEqual(getAppendableKitchenRoots([root]), [root])
})
