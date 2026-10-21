import { useEffect, useState } from 'react'
import { AlertCircle, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { listKitchenQueue, payKitchenOrder, setKitchenItemPreparation } from './kitchen-order-api'
import type { KitchenQueueOrder } from './kitchen-order-api'
import './kitchen-order.css'

type QueueRole = 'owner' | 'cashier' | 'tenant' | 'kitchen'
type QueueUnit = { id: string; name: string; kind: 'branch' | 'bazaar' }
type Props = { role: QueueRole; profileUnitId: string | null; backendReady: boolean }

const paymentMethods = [
  ['cash', 'Tunai'], ['bank_transfer', 'Transfer'], ['qris', 'QRIS'], ['debit', 'Debit'], ['other', 'Lainnya'],
] as const

function money(value: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0)
}

export default function KitchenQueue({ role, profileUnitId, backendReady }: Props) {
  const [units, setUnits] = useState<QueueUnit[]>([])
  const [selectedUnitId, setSelectedUnitId] = useState(profileUnitId || '')
  const [orders, setOrders] = useState<KitchenQueueOrder[]>([])
  const [loadingUnits, setLoadingUnits] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<(typeof paymentMethods)[number][0]>('cash')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (role !== 'owner' || !supabase || !backendReady) return
    let current = true
    setLoadingUnits(true)
    supabase.from('business_units').select('id,name,kind').eq('is_active', true).order('name')
      .then(({ data, error: loadError }) => {
        if (!current) return
        if (loadError) setError(`Daftar unit belum dapat dimuat: ${loadError.message}`)
        else {
          const next = (data || []) as QueueUnit[]
          setUnits(next)
          if (!selectedUnitId && next.length === 1) setSelectedUnitId(next[0].id)
        }
        setLoadingUnits(false)
      })
    return () => { current = false }
  }, [role, backendReady])

  async function refresh() {
    if (!backendReady || !selectedUnitId) return
    setLoading(true)
    setError('')
    try { setOrders(await listKitchenQueue(selectedUnitId)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Antrean belum dapat dimuat.') }
    finally { setLoading(false) }
  }

  useEffect(() => { void refresh() }, [backendReady, selectedUnitId])

  async function changePreparation(itemId: string, status: 'preparing' | 'ready') {
    setBusyId(itemId); setError(''); setNotice('')
    try {
      await setKitchenItemPreparation(itemId, status)
      setNotice('Status persiapan item diperbarui.')
      await refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Status item belum dapat diperbarui.') }
    finally { setBusyId('') }
  }

  async function confirmPayment(order: KitchenQueueOrder) {
    const hasCancelledRound = orders.some(candidate => candidate.root_order_id === order.root_order_id && candidate.status === 'cancelled')
    if (hasCancelledRound) {
      setError('Pembayaran belum dapat diproses: ada round yang dibatalkan dalam grup order ini.')
      return
    }
    const rootTotal = orders.filter(candidate => candidate.root_order_id === order.root_order_id)
      .reduce((sum, candidate) => sum + Number(candidate.total || 0), 0)
    if (rootTotal <= 0) {
      setError('Pembayaran belum dapat diproses: total order harus lebih besar dari nol agar pencatatan kas valid.')
      return
    }
    if (!window.confirm(`Konfirmasi pembayaran seluruh order dan round susulan sebesar ${money(rootTotal)}?`)) return
    setBusyId(order.root_order_id); setError(''); setNotice('')
    try {
      const result = await payKitchenOrder(order.root_order_id, paymentMethod)
      setNotice(result.status === 'already_paid' ? 'Pembayaran order ini sudah tercatat sebelumnya.' : 'Pembayaran tercatat.')
      await refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Pembayaran belum dapat dikonfirmasi. Periksa status order sebelum mencoba ulang.') }
    finally { setBusyId('') }
  }

  const canUpdateKitchen = role === 'kitchen' || role === 'owner'
  const canPay = role === 'cashier' || role === 'tenant' || role === 'owner'

  return <div className="kitchen-queue-page">
    <div className="page-heading">
      <div><p className="eyebrow">OPERASIONAL DAPUR</p><h1>Antrean Dapur</h1><p className="muted">Persiapan dicatat per item. Pembayaran dilakukan terpisah saat pelanggan siap.</p></div>
      <button type="button" className="secondary-button" onClick={() => void refresh()} disabled={!backendReady || loading || !selectedUnitId}><RefreshCw size={16} /> Muat ulang</button>
    </div>
    {role === 'owner' && <label className="field kitchen-unit-select"><span>Unit usaha</span><select value={selectedUnitId} onChange={event => setSelectedUnitId(event.target.value)} disabled={loadingUnits}><option value="">Pilih unit…</option>{units.map(unit => <option key={unit.id} value={unit.id}>{unit.name} · {unit.kind === 'branch' ? 'Cabang' : 'Bazar'}</option>)}</select></label>}
    {error && <div className="order-flow-feedback order-flow-feedback-error" role="alert"><AlertCircle size={16} /> {error}</div>}
    {notice && <div className="order-flow-feedback" role="status">{notice}</div>}
    {!backendReady ? <div className="order-flow-notice" role="status"><ShieldCheck size={18} /><p>Antrean belum terhubung. Definisi RPC, grants, policy unit, dan migration backend belum diverifikasi/diaktifkan.</p></div>
      : loading ? <div className="order-flow-empty"><LoaderCircle className="spin" size={18} /> Memuat antrean…</div>
        : orders.length === 0 ? <div className="order-flow-empty">Tidak ada order aktif yang dapat ditampilkan untuk unit ini.</div>
          : <div className="kitchen-queue-list">{orders.map(order => <article className="kitchen-queue-card" key={order.order_id}>
              <header><div><span className="eyebrow">{order.parent_order_id ? `ROUND ${order.round_number}` : 'ORDER AWAL'}</span><h2>{order.service_type === 'dine_in' ? `Meja ${order.table_number}` : `Takeaway · ${order.customer_label || 'Tanpa identitas'}`}</h2><p>#{order.order_number} · {new Date(order.created_at).toLocaleString('id-ID')} · {order.status}</p></div><strong>{money(order.total)}</strong></header>
              <div className="kitchen-queue-items">{order.items.map(item => <section className="kitchen-queue-item" key={item.id}>
                  <div><strong>{item.menu_name_snapshot} × {item.quantity}</strong><span>{item.item_notes || 'Tanpa catatan'} · {item.preparation_status}</span></div>
                  {canUpdateKitchen && item.preparation_status !== 'ready' && <button type="button" className="small-action" disabled={busyId === item.id} onClick={() => void changePreparation(item.id,item.preparation_status === 'queued' ? 'preparing' : 'ready')}>{busyId === item.id ? 'Menyimpan…' : item.preparation_status === 'queued' ? 'Mulai persiapan' : 'Tandai siap'}</button>}
                </section>)}</div>
              {canPay && !order.parent_order_id && <div className="kitchen-queue-payment"><label className="field"><span>Metode pembayaran</span><select value={paymentMethod} onChange={event => setPaymentMethod(event.target.value as typeof paymentMethod)}><option value="cash">Tunai</option><option value="bank_transfer">Transfer</option><option value="qris">QRIS</option><option value="debit">Debit</option><option value="other">Lainnya</option></select></label><button type="button" className="primary-button" disabled={busyId === order.root_order_id || orders.some(candidate => candidate.root_order_id === order.root_order_id && candidate.status === 'cancelled') || orders.filter(candidate => candidate.root_order_id === order.root_order_id).reduce((sum, candidate) => sum + Number(candidate.total || 0), 0) <= 0} onClick={() => void confirmPayment(order)}>Bayar seluruh order ({money(orders.filter(candidate => candidate.root_order_id === order.root_order_id).reduce((sum, candidate) => sum + Number(candidate.total || 0), 0))})</button></div>}
            </article>)}</div>}
  </div>
}
