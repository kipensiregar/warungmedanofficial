    setLastReceipt(null)
    if (!supabase) return
    if (!selectedUnit) { setError('Pilih unit penjualan terlebih dahulu.'); return }
    if (!cart.length) { setError('Keranjang masih kosong.'); return }
    if (!activeUnit) { setError('Unit penjualan tidak ditemukan atau tidak aktif.'); return }
    if (discount > subtotal) { setError('Diskon tidak boleh melebihi subtotal.'); return }
    if (!Number.isFinite(discount) || discount < 0) { setError('Diskon tidak valid.'); return }
    setSaving(true)
    const requestId = crypto.randomUUID()
    const { data, error: rpcError } = await supabase.rpc('post_sale', {
      p_client_request_id: requestId,
      p_unit_id: selectedUnit,
      p_payment_method: payment,
      p_items: cart.map(row => ({ menu_item_id: row.menu.id, quantity: row.quantity })),
      p_discount: discount,
    })
    if (rpcError) {
      setError(`Transaksi gagal disimpan: ${rpcError.message}`)
      setSaving(false)
      return
    }
    const result = data as { sale_id?: string; subtotal?: number; total?: number; status?: string } | null
    if (!result?.sale_id) {
      setError('Server tidak mengembalikan nomor transaksi. Periksa riwayat transaksi sebelum mencoba lagi.')
      setSaving(false)
      return
    }
    setLastReceipt({ sale_id: result.sale_id, subtotal: Number(result.subtotal ?? subtotal), total: Number(result.total ?? total), status: result.status })
    setSuccess(result.status === 'existing' ? 'Transaksi ini sudah pernah tersimpan.' : 'Transaksi berhasil disimpan.')
    setCart([])
    setDiscountText('0')
    setSaving(false)
  }

  return <div className="sales-page">
    <div className="page-heading">
      <div><p className="eyebrow">TRANSAKSI PENJUALAN</p><h1>Kasir & Penjualan</h1><p className="muted">Pilih menu, masukkan jumlah, lalu simpan transaksi ke database.</p></div>
      <button className="secondary-button" onClick={() => void loadSalesData()} disabled={loading}><RefreshCw size={16} /> Muat ulang</button>
    </div>
    {error && <div className="form-message users-alert">{error}</div>}
    {success && <div className="users-success"><CheckCircle2 size={17} />{success}</div>}
    {lastReceipt && <div className="sale-receipt">
      <div className="receipt-title"><Receipt size={20} /><strong>Transaksi tersimpan</strong></div>
      <p>Nomor transaksi: <strong>{lastReceipt.sale_id}</strong></p>
      <div className="receipt-totals"><span>Subtotal <strong>{money(lastReceipt.subtotal || 0)}</strong></span><span>Total dibayar <strong>{money(lastReceipt.total || 0)}</strong></span></div>
      <button type="button" className="secondary-button" onClick={() => {
        const text = `WARUNG MEDAN CT CATERING\nBukti transaksi\nNo: ${lastReceipt.sale_id}\nUnit: ${activeUnit?.name || selectedUnit}\nSubtotal: ${money(lastReceipt.subtotal || 0)}\nTotal: ${money(lastReceipt.total || 0)}`
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url; a.download = `struk-${lastReceipt.sale_id}.txt`; a.click()
        URL.revokeObjectURL(url)
      }}>Simpan bukti transaksi</button>
    </div>}
    <div className="sales-layout">
      <section className="sales-menu-panel">
        <div className="sales-panel-heading"><div><h2>Daftar menu</h2><p className="muted">Menu aktif dari database</p></div><span className="phase-pill">{menu.length} menu</span></div>
        {isOwner && <label className="field sales-unit-field"><span>Unit penjualan</span><select required value={selectedUnit} onChange={e => setSelectedUnit(e.target.value)}><option value="">Pilih cabang atau bazar…</option>{units.map(unit => <option key={unit.id} value={unit.id}>{unit.name} · {unit.kind === 'branch' ? 'Cabang' : 'Bazar'}</option>)}</select></label>}
        {!isOwner && <div className="sales-unit-pill"><Store size={16} /> Unit: <strong>{units.find(unit => unit.id === profile?.unit_id)?.name || 'Unit akun'}</strong></div>}
        <input className="sales-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari menu atau kategori…" aria-label="Cari menu" />
        {loading ? <div className="users-empty"><LoaderCircle className="spin" size={20} /> Memuat menu…</div>
          : visibleMenu.length === 0 ? <div className="users-empty">{menu.length ? 'Menu tidak ditemukan.' : 'Belum ada menu aktif di database. Tambahkan menu terlebih dahulu.'}</div>
          : <div className="sales-menu-grid">{visibleMenu.map(item => <article className="sales-menu-card" key={item.id}>
              <div className="sales-menu-meta">{item.category || 'Menu'}{item.sku ? ` · ${item.sku}` : ''}</div>
              <h3>{item.name}</h3><strong className="sales-price">{money(Number(item.sale_price))}</strong>
              <button type="button" className="small-action add-menu-button" onClick={() => addItem(item)}><Plus size={15} /> Tambah</button>
            </article>)}</div>}
      </section>
      <form className="sales-cart-panel" onSubmit={submitSale}>
        <div className="sales-panel-heading"><div><h2><ShoppingCart size={19} /> Keranjang</h2><p className="muted">{cart.length} jenis menu</p></div></div>
        {cart.length === 0 ? <div className="sales-cart-empty"><ShoppingCart size={26} /><p>Keranjang masih kosong.</p><span>Pilih menu di sebelah kiri untuk memulai transaksi.</span></div>
          : <div className="sales-cart-list">{cart.map(row => <div className="sales-cart-row" key={row.menu.id}>
              <div className="sales-cart-info"><strong>{row.menu.name}</strong><span>{money(Number(row.menu.sale_price))} / item</span><b>{money(Number(row.menu.sale_price) * row.quantity)}</b></div>
              <div className="sales-quantity"><button type="button" aria-label="Kurangi jumlah" onClick={() => changeQuantity(row.menu.id, -1)}><Minus size={14} /></button><strong>{row.quantity}</strong><button type="button" aria-label="Tambah jumlah" onClick={() => changeQuantity(row.menu.id, 1)}><Plus size={14} /></button><button type="button" className="remove-cart-item" aria-label="Hapus item" onClick={() => setCart(current => current.filter(item => item.menu.id !== row.menu.id))}><Trash2 size={15} /></button></div>
            </div>)}</div>}
        <div className="sales-checkout">
          <label className="field"><span>Diskon (Rp)</span><input type="number" min="0" step="1" value={discountText} onChange={e => setDiscountText(e.target.value)} /></label>
          <label className="field"><span>Metode pembayaran</span><select value={payment} onChange={e => setPayment(e.target.value as typeof payment)}><option value="cash">Tunai</option><option value="bank_transfer">Transfer bank</option><option value="qris">QRIS</option><option value="debit">Debit</option><option value="other">Lainnya</option></select></label>
          <div className="sales-total-line"><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
          <div className="sales-total-line"><span>Diskon</span><strong>− {money(discount)}</strong></div>
          <div className="sales-grand-total"><span>Total</span><strong>{money(total)}</strong></div>
          <button className="primary-button sales-submit" type="submit" disabled={saving || loading || !cart.length || !selectedUnit}>{saving ? <LoaderCircle size={17} className="spin" /> : <CheckCircle2 size={17} />}{saving ? 'Menyimpan transaksi…' : 'Simpan transaksi'}</button>
          <p className="sales-note"><ShieldCheck size={14} /> Stok bahan baku tidak berkurang otomatis dari penjualan.</p>
        </div>
      </form>
    </div>
  </div>
}

function SetupScreen() {
  return <div className="center-screen"><div className="setup-card"><div className="brand-mark large"><Cloud size={28} /></div><p className="eyebrow">LANGKAH PERTAMA</p><h1>Hubungkan database cloud</h1><p className="muted">Aplikasi berhasil dimuat, tetapi konfigurasi Supabase belum diisi. Isi URL proyek dan publishable key di environment build.</p><div className="warning-box"><ShieldCheck size={18} /><p>Jangan masukkan service-role key ke aplikasi browser atau repository.</p></div></div></div>
}
function LoginScreen({ email, setEmail, password, setPassword, onSubmit, message }: { email: string; setEmail: (v: string) => void; password: string; setPassword: (v: string) => void; onSubmit: (e: FormEvent<HTMLFormElement>) => void; message: string }) {
  return <div className="login-layout"><div className="login-story"><div className="brand light"><div className="brand-mark"><Store size={22} /></div><div><strong>Warung Medan</strong><span>CT Catering · Sistem Terpadu</span></div></div><div className="story-copy"><p className="eyebrow">SATU OPERASIONAL · SATU DATA</p><h1>Dari dapur sampai laporan, semua terhubung.</h1><p>Kasir, pesanan dapur, stok bahan baku, dan keuangan dirancang untuk bekerja dalam satu alur yang dapat diaudit.</p><div className="story-points"><span><Package size={17} /> Stok bahan baku dicatat manual</span><span><ArrowUpRight size={17} /> Laporan per unit</span><span><ShieldCheck size={17} /> Akses sesuai peran</span></div></div><div className="story-footer">Dibangun untuk operasional Warung Medan CT Catering.</div></div><div className="login-panel"><form className="login-card" onSubmit={onSubmit}><div className="login-icon"><LogIn size={23} /></div><p className="eyebrow">SELAMAT DATANG KEMBALI</p><h2>Masuk ke aplikasi</h2><p className="muted">Gunakan akun yang telah dibuat oleh Owner.</p><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} placeholder="nama@perusahaan.com" /><label htmlFor="password">Kata sandi</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Masukkan kata sandi" />{message && <div className="form-message">{message}</div>}<button className="primary-button" type="submit">Masuk <ArrowUpRight size={17} /></button><p className="login-footnote"><ShieldCheck size={15} /> Login dilayani oleh Supabase Auth.</p></form></div></div>
}
function Dashboard({ profile, email }: { profile: Profile | null; email: string }) {
  const name = profile?.display_name || email.split('@')[0] || 'Pengguna'
  const role = profile?.role
  return <><div className="page-heading"><div><p className="eyebrow">RINGKASAN OPERASIONAL</p><h1>Halo, {name} 👋</h1><p className="muted">Selamat datang di workspace Warung Medan CT Catering.</p></div><div className="connection-pill"><span className="status-dot" /> Terhubung ke akun</div></div><div className="welcome-banner"><div><span className="banner-tag">WORKSPACE AKTIF</span><h2>{role ? roleLabels[role] : 'Akses sedang disiapkan'}</h2><p>{profile?.unit_id ? 'Unit penugasan aktif' : role === 'owner' ? 'Anda memiliki akses lintas unit.' : 'Unit penugasan belum ditentukan oleh Owner.'}</p></div><div className="banner-icon"><Store size={38} /></div></div><div className="section-heading"><div><h2>Modul aplikasi</h2><p>Fondasi navigasi untuk pengembangan berikutnya.</p></div><span className="phase-pill">FASE 1 · FONDASI</span></div><div className="module-grid">{[
    { title: 'Kasir & Penjualan', description: 'Transaksi, pembayaran, dan struk.', icon: ShoppingBasket, status: 'Dalam pengembangan' },
    { title: 'Dapur & Pesanan', description: 'Antrean pesanan dan status masak.', icon: ChefHat, status: 'Dalam pengembangan' },
    { title: 'Stok bahan baku', description: 'Penerimaan dan pengeluaran stok manual.', icon: Package, status: 'Dalam pengembangan' },
    { title: 'Keuangan', description: 'Kas, beban, dan laba rugi.', icon: CircleDollarSign, status: role === 'owner' ? 'Khusus Owner' : 'Akses dibatasi' },
    { title: 'Laporan', description: 'Per unit dan konsolidasi usaha.', icon: BarChart3, status: role === 'owner' ? 'Khusus Owner' : 'Akses dibatasi' },
    { title: 'Penerimaan stok', description: 'Catat bahan masuk per unit.', icon: ArrowDownToLine, status: 'Dalam pengembangan' },
  ].filter(m => role === 'owner' || !['Keuangan', 'Laporan'].includes(m.title)).map(m => <article className="module-card" key={m.title}><div className="module-icon"><m.icon size={20} /></div><h3>{m.title}</h3><p>{m.description}</p><span className="module-status">{m.status}</span></article>)}</div><div className="next-step"><div className="next-icon"><Database size={20} /></div><div><strong>Fondasi database sudah disiapkan.</strong><p>Modul operasional akan diaktifkan bertahap setelah pengujian akses dan alur transaksi.</p></div><ClipboardList className="next-arrow" size={20} /></div></>
}
function ModulePlaceholder({ title, role }: { title: string; role?: Role }) {
  return <div className="placeholder-card"><div className="module-icon"><ClipboardList size={23} /></div><p className="eyebrow">MODUL TERENCANA</p><h1>{title}</h1><p className="muted">Modul ini belum diaktifkan pada baseline pertama. Struktur akses dan database akan disiapkan sebelum transaksi nyata diaktifkan.</p><div className="warning-box"><ShieldCheck size={18} /><p>Peran saat ini: <strong>{role ? roleLabels[role] : 'belum ditetapkan'}</strong>. Jangan mencatat transaksi produksi di modul yang belum selesai.</p></div><button className="secondary-button" onClick={() => window.location.reload()}>Muat ulang aplikasi</button></div>
}
