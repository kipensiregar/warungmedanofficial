import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ChefHat, LoaderCircle, Plus, Trash2 } from 'lucide-react'
import './kitchen-order.css'
import { appendKitchenRound, createKitchenOrder } from './kitchen-order-api'
import type { KitchenQueueOrder } from './kitchen-order-api'
import { getAppendableKitchenRoots } from './kitchen-order-response'

export type OrderMenuItem = {
  id: string
  name: string
  sale_price: number
  is_active: boolean
}

type DraftItem = {
  draftId: string
  menuId: string
  quantity: number | ''
  notes: string
}

type KitchenOrderComposerProps = {
  menu: OrderMenuItem[]
  unitName: string
  unitId: string
  menuLoading: boolean
  menuError: string
  backendReady?: boolean
  activeOrders?: KitchenQueueOrder[]
  ordersLoading?: boolean
  ordersError?: string
  onRefreshOrders?: () => Promise<void>
}

type PendingRequest =
  | { mode: 'create'; requestId: string; payload: Parameters<typeof createKitchenOrder>[0] }
  | { mode: 'append'; requestId: string; payload: Parameters<typeof appendKitchenRound>[0] }

function money(value: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value || 0)
}

export default function KitchenOrderComposer({ menu, unitName, unitId, menuLoading, menuError, backendReady = false, activeOrders = [], ordersLoading = false, ordersError = '', onRefreshOrders }: KitchenOrderComposerProps) {
  const previousUnitId = useRef(unitId)
  const [serviceType, setServiceType] = useState<'dine_in' | 'takeaway'>('dine_in')
  const [orderMode, setOrderMode] = useState<'new' | 'append'>('new')
  const [appendRootId, setAppendRootId] = useState('')
  const [tableNumber, setTableNumber] = useState('')
  const [selectedMenuId, setSelectedMenuId] = useState('')
  const [draftItems, setDraftItems] = useState<DraftItem[]>([])
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [sendSuccess, setSendSuccess] = useState('')
  const [pendingRequest, setPendingRequest] = useState<PendingRequest | null>(null)

  const activeMenu = menu.filter(item => item.is_active)
  const menuById = new Map(activeMenu.map(item => [item.id, item]))
  const unpaidRoots = activeOrders.filter(order => order.parent_order_id === null && order.payment_status === 'unpaid')
  const appendableRoots = getAppendableKitchenRoots(activeOrders)
  const draftTotal = draftItems.reduce((sum, row) => {
    const menuItem = menuById.get(row.menuId)
    return sum + (menuItem ? Number(menuItem.sale_price) * Number(row.quantity || 0) : 0)
  }, 0)
  const draftIssues = [
    !unitId ? 'Pilih unit usaha terlebih dahulu.' : '',
    orderMode === 'new' && serviceType === 'dine_in' && !tableNumber.trim() ? 'Nomor meja wajib diisi untuk makan di tempat.' : '',
    orderMode === 'append' && !appendableRoots.some(order => order.root_order_id === appendRootId) ? 'Pilih order aktif yang belum dibatalkan untuk pesanan susulan.' : '',
    draftItems.length === 0 ? 'Tambahkan minimal satu item menu.' : '',
    draftItems.some(row => !menuById.has(row.menuId)) ? 'Ada menu draf yang sudah tidak aktif; hapus item tersebut.' : '',
    draftItems.some(row => typeof row.quantity !== 'number' || !Number.isInteger(row.quantity) || row.quantity < 1) ? 'Jumlah setiap item harus berupa bilangan bulat positif.' : '',
    draftItems.some(row => row.notes.length > 300) ? 'Catatan item maksimal 300 karakter.' : '',
  ].filter(Boolean)

  useEffect(() => {
    if (previousUnitId.current === unitId) return
    previousUnitId.current = unitId
    if (pendingRequest) return
    setDraftItems([])
    setTableNumber('')
    setSelectedMenuId('')
    setAppendRootId('')
    setOrderMode('new')
  }, [unitId, pendingRequest])

  function addDraftItem() {
    if (!selectedMenuId) return
    setDraftItems(current => [...current, {
      draftId: crypto.randomUUID(),
      menuId: selectedMenuId,
      quantity: 1,
      notes: '',
    }])
    setSelectedMenuId('')
  }

  function updateItem(draftId: string, updates: Partial<Pick<DraftItem, 'quantity' | 'notes'>>) {
    setDraftItems(current => current.map(item => item.draftId === draftId ? { ...item, ...updates } : item))
  }

  async function sendDraft() {
    if (!backendReady || sending || draftIssues.length) return
    const request: PendingRequest = pendingRequest || (() => {
      const requestId = crypto.randomUUID()
      const items = draftItems.map(item => ({ menu_item_id: item.menuId, quantity: item.quantity as number, item_notes: item.notes.trim() || null }))
      const next: PendingRequest = orderMode === 'new'
        ? { mode: 'create', requestId, payload: { requestId, unitId, serviceType, tableNumber: tableNumber.trim() || null, items } }
        : { mode: 'append', requestId, payload: { requestId, rootOrderId: appendRootId, items } }
      setPendingRequest(next)
      return next
    })()
    setSending(true)
    setSendError('')
    setSendSuccess('')
    try {
      const result = request.mode === 'create'
        ? await createKitchenOrder(request.payload)
        : await appendKitchenRound(request.payload)
      if (!result.order_id) throw new Error('Server tidak mengembalikan ID order; periksa antrean sebelum mencoba kembali.')
      setSendSuccess(request.mode === 'append'
        ? `Pesanan susulan round ${result.round_number || ''} tersimpan di dapur.`
        : `Order ${result.order_number ? `#${result.order_number}` : ''} tersimpan di dapur.`)
      setDraftItems([])
      setTableNumber('')
      setSelectedMenuId('')
      setPendingRequest(null)
      setOrderMode('new')
      setAppendRootId('')
      await onRefreshOrders?.()
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Order belum dapat dikonfirmasi. Gunakan request yang sama saat mencoba ulang.')
    } finally {
      setSending(false)
    }
  }

  return <section className="order-flow-panel" aria-labelledby="order-flow-title">
    <div className="order-flow-heading">
      <div>
        <p className="eyebrow">ALUR PESANAN DAPUR</p>
        <h2 id="order-flow-title"><ChefHat size={20} /> Draf order dapur</h2>
        <p className="muted">Pilih meja atau identitas pesanan, lalu siapkan item dan catatan untuk dapur.</p>
      </div>
      <span className="order-flow-status">{backendReady ? 'Backend terhubung' : 'Backend belum terhubung'}</span>
    </div>

    <div className="order-flow-grid">
      <div className="order-flow-editor">
        <p className="order-flow-unit">Unit: <strong>{unitName || 'Pilih unit pada panel Kasir'}</strong></p>
        {menuLoading && <div className="order-flow-feedback" role="status"><LoaderCircle className="spin" size={16} /> Memuat menu dari sumber Kasir…</div>}
        {!menuLoading && menuError && <div className="order-flow-feedback order-flow-feedback-error" role="alert"><AlertCircle size={16} /> Menu belum dapat dimuat: {menuError}</div>}
        <div className="order-flow-fields">
          <label className="field">
            <span>Jenis order</span>
            <select value={orderMode} disabled={sending || Boolean(pendingRequest)} onChange={event => setOrderMode(event.target.value as typeof orderMode)}>
              <option value="new">Order baru</option>
              <option value="append">Tambah ke order aktif</option>
            </select>
          </label>
          {orderMode === 'append' ? <label className="field">
            <span>Order / meja aktif</span>
            <select value={appendRootId} disabled={!backendReady || sending || Boolean(pendingRequest)} onChange={event => setAppendRootId(event.target.value)}>
              <option value="">Pilih order aktif…</option>
              {appendableRoots.map(order => <option key={order.root_order_id} value={order.root_order_id}>{order.service_type === 'dine_in' ? `Meja ${order.table_number}` : `Takeaway ${order.customer_label || 'Tanpa identitas'}`} · #${order.order_number}</option>)}
            </select>
          </label> : <label className="field">
            <span>Nomor meja / identitas</span>
            <input value={tableNumber} disabled={sending || Boolean(pendingRequest)} onChange={event => setTableNumber(event.target.value)} maxLength={40} placeholder={serviceType === 'dine_in' ? 'Nomor meja' : 'Nama atau kode takeaway'} required={serviceType === 'dine_in'} />
          </label>}
        </div>
        {orderMode === 'new' && <div className="order-flow-fields">
          <label className="field">
            <span>Jenis pesanan</span>
            <select value={serviceType} disabled={sending || Boolean(pendingRequest)} onChange={event => setServiceType(event.target.value as typeof serviceType)}>
              <option value="dine_in">Makan di tempat</option>
              <option value="takeaway">Bungkus / takeaway</option>
            </select>
          </label>
        </div>}

        <div className="order-flow-add-row">
          <label className="field">
            <span>Menu</span>
            <select value={selectedMenuId} onChange={event => setSelectedMenuId(event.target.value)} disabled={!unitId || menuLoading || Boolean(menuError) || activeMenu.length === 0 || sending || Boolean(pendingRequest)}>
              <option value="">Pilih menu aktif…</option>
              {activeMenu.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <button type="button" className="small-action" onClick={addDraftItem} disabled={!selectedMenuId || sending || Boolean(pendingRequest)}>
            <Plus size={15} /> Tambahkan
          </button>
        </div>

        {draftItems.length === 0 ? <div className="order-flow-empty">Belum ada item di draf order.</div> : <div className="order-flow-items">
          {draftItems.map((item, index) => {
            const menuItem = menuById.get(item.menuId)
            return <article className="order-flow-item" key={item.draftId}>
              <div className="order-flow-item-title">
                <strong>{menuItem?.name || 'Menu tidak lagi tersedia'}</strong>
                {menuItem && <span>{money(Number(menuItem.sale_price))} / item</span>}
                <button type="button" className="order-flow-remove" aria-label={`Hapus ${menuItem?.name || 'item'}`} onClick={() => setDraftItems(current => current.filter(row => row.draftId !== item.draftId))}>
                  <Trash2 size={15} />
                </button>
              </div>
              <label className="field">
                <span>Jumlah item {index + 1}</span>
                <input type="number" min="1" step="1" value={item.quantity} disabled={sending || Boolean(pendingRequest)} onChange={event => updateItem(item.draftId, { quantity: event.target.value === '' ? '' : Number(event.target.value) })} />
              </label>
              <label className="field">
                <span>Catatan untuk dapur</span>
                <textarea maxLength={300} value={item.notes} disabled={sending || Boolean(pendingRequest)} onChange={event => updateItem(item.draftId, { notes: event.target.value })} placeholder="Contoh: sambal dipisah, tidak pakai bawang" rows={2} />
                {menuItem && <small className="order-flow-line-estimate">Estimasi item: {money(Number(menuItem.sale_price) * Number(item.quantity || 0))}</small>}
              </label>
            </article>
          })}
        </div>}

        <div className="order-flow-summary" aria-label="Ringkasan estimasi order">
          <span>{draftItems.length} baris item</span>
          <strong>Estimasi total: {money(draftTotal)}</strong>
          <small>Perkiraan memakai harga menu yang sedang dimuat, belum termasuk diskon. Harga final harus dikunci server saat dikirim.</small>
        </div>

        <div className={`order-flow-validation${draftIssues.length ? ' has-issues' : ''}`} aria-live="polite">
          {draftIssues.length
            ? <><strong>Draf belum lengkap</strong><ul>{draftIssues.map(issue => <li key={issue}>{issue}</li>)}</ul></>
            : <strong>{backendReady ? 'Draf lengkap dan siap dikirim.' : 'Draf lengkap untuk ditinjau. Pengiriman tetap nonaktif sampai backend order tersedia.'}</strong>}
        </div>

        {sendError && <div className="order-flow-feedback order-flow-feedback-error" role="alert"><AlertCircle size={16} /> {sendError}</div>}
        {sendSuccess && <div className="order-flow-feedback" role="status">{sendSuccess}</div>}
        <div className="order-flow-notice" role="status">
          <AlertCircle size={17} />
          <p>{backendReady ? 'Harga final dan snapshot item ditentukan server saat order dikirim.' : 'Draf hanya tersimpan sementara di halaman ini. Belum ada order atau item yang dikirim ke database.'}</p>
        </div>
        <button type="button" className="primary-button order-flow-submit" onClick={() => void sendDraft()} disabled={!backendReady || Boolean(draftIssues.length) || sending}>
          {sending ? <LoaderCircle className="spin" size={17} /> : <ChefHat size={17} />} {pendingRequest ? 'Coba ulang kirim order' : 'Kirim ke Dapur'}{!backendReady ? ' · Belum terverifikasi' : ''}
        </button>
      </div>

      <aside className="order-flow-active" aria-labelledby="active-orders-title">
        <div className="order-flow-active-title">
          <h3 id="active-orders-title">Order aktif</h3>
          <span className="order-flow-status">{!backendReady ? 'Belum terhubung' : ordersLoading ? 'Memuat…' : `${unpaidRoots.length} order belum dibayar`}</span>
        </div>
        {backendReady && <button type="button" className="secondary-button" onClick={() => void onRefreshOrders?.()} disabled={ordersLoading || !onRefreshOrders}>{ordersLoading ? 'Memuat…' : 'Muat ulang order'}</button>}
        {ordersError && <div className="order-flow-feedback order-flow-feedback-error" role="alert"><AlertCircle size={16} /> {ordersError}</div>}
        {!backendReady
          ? <div className="order-flow-empty order-flow-empty-large"><p>Daftar order aktif belum terhubung.</p><span>Antrean akan muncul setelah RPC dan akses unit tersedia.</span></div>
          : ordersLoading && activeOrders.length === 0
            ? <div className="order-flow-empty order-flow-empty-large">Memuat order aktif…</div>
          : unpaidRoots.length === 0
              ? <div className="order-flow-empty order-flow-empty-large"><p>Tidak ada order aktif.</p><span>Order baru yang dikirim akan muncul di daftar ini.</span></div>
              : <div className="order-flow-active-list">{unpaidRoots.map(root => {
                  const rounds = activeOrders.filter(order => order.root_order_id === root.root_order_id)
                  const itemCount = rounds.reduce((sum, round) => sum + round.items.reduce((items, item) => items + item.quantity, 0), 0)
                  const total = rounds.reduce((sum, round) => sum + Number(round.total || 0), 0)
                  const canAppend = appendableRoots.some(order => order.root_order_id === root.root_order_id)
                  return <article className="order-flow-active-card" key={root.root_order_id}>
                    <div><strong>{root.service_type === 'dine_in' ? `Meja ${root.table_number}` : `Takeaway · ${root.customer_label || 'Tanpa identitas'}`}</strong><span>#{root.order_number} · {rounds.length} round · {itemCount} item{canAppend ? '' : ' · ada round dibatalkan'}</span></div>
                    <strong>{money(total)}</strong>
                    <button type="button" className="small-action" disabled={!canAppend || sending || Boolean(pendingRequest)} onClick={() => { setOrderMode('append'); setAppendRootId(root.root_order_id); setServiceType(root.service_type); setTableNumber(root.service_type === 'takeaway' ? root.customer_label || '' : root.table_number || '') }}>{canAppend ? 'Tambah pesanan susulan' : 'Round dibatalkan'}</button>
                  </article>
                })}</div>}
        <p className="order-flow-payment-note">Pembayaran dilakukan terpisah melalui antrean setelah pelanggan siap membayar.</p>
      </aside>
    </div>
  </section>
}
