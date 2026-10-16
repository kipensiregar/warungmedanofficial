import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  Activity, ArrowDownToLine, ArrowUpRight, BarChart3, ChefHat,
  CircleDollarSign, ClipboardList, Cloud, Database, LayoutDashboard,
  LogIn, LogOut, Package, ShieldCheck, ShoppingBasket, Store, Users,
  Pencil, UserPlus, RefreshCw, Ban, CheckCircle2, X, LoaderCircle,
  Plus, Minus, Trash2, Receipt, ShoppingCart, Utensils, ClipboardCheck,
} from 'lucide-react'
import { isSupabaseConfigured, supabase } from './lib/supabase'

type Role = 'owner' | 'cashier' | 'tenant' | 'kitchen'
type Profile = {
  user_id?: string
  display_name: string | null
  role: Role
  unit_id: string | null
  is_active: boolean
}
type BusinessUnit = { id: string; code: string; name: string; kind: 'branch' | 'bazaar'; is_active: boolean }
type ManagedUser = Profile & { user_id: string; email: string | null; created_at?: string | null }
type AppPermissions = {
  stock_view: boolean; stock_receive: boolean; stock_issue: boolean;
  ingredient_manage: boolean; sales_create: boolean; reports_view: boolean; users_manage: boolean;
}
const permissionFields: { key: keyof AppPermissions; label: string; description: string }[] = [
  { key: 'stock_view', label: 'Lihat stok', description: 'Melihat saldo dan riwayat stok unit.' },
  { key: 'stock_receive', label: 'Stok masuk', description: 'Mencatat penerimaan bahan baku.' },
  { key: 'stock_issue', label: 'Stok keluar', description: 'Mencatat pengeluaran bahan baku manual.' },
  { key: 'ingredient_manage', label: 'Kelola bahan baku', description: 'Menambah atau mengubah daftar bahan baku.' },
  { key: 'sales_create', label: 'Buat penjualan', description: 'Membuat transaksi penjualan.' },
  { key: 'reports_view', label: 'Lihat laporan', description: 'Membuka laporan yang tersedia.' },
  { key: 'users_manage', label: 'Kelola pengguna', description: 'Mengelola akses pengguna; tetap dibatasi kebijakan Owner.' },
]
const defaultPermissions: AppPermissions = { stock_view: true, stock_receive: false, stock_issue: false, ingredient_manage: false, sales_create: false, reports_view: false, users_manage: false }
const deniedPermissions: AppPermissions = { stock_view: false, stock_receive: false, stock_issue: false, ingredient_manage: false, sales_create: false, reports_view: false, users_manage: false }

const roleLabels: Record<Role, string> = {
  owner: 'Owner', cashier: 'Kasir Cabang', tenant: 'Tim Tenant', kitchen: 'Tim Dapur',
}
const navItems = [
  { label: 'Dashboard', icon: LayoutDashboard, roles: ['owner', 'cashier', 'tenant', 'kitchen'] },
  { label: 'Kasir & Penjualan', icon: ShoppingBasket, roles: ['owner', 'cashier', 'tenant'] },
  { label: 'Antrean Dapur', icon: ChefHat, roles: ['owner', 'kitchen', 'tenant'] },
  { label: 'Stok Bahan Baku', icon: Package, roles: ['owner', 'cashier', 'kitchen'] },
  { label: 'Stok Opname & Audit', icon: ClipboardCheck, roles: ['owner', 'cashier', 'tenant', 'kitchen'] },
  { label: 'Keuangan', icon: CircleDollarSign, roles: ['owner'] },
  { label: 'Laporan', icon: BarChart3, roles: ['owner'] },
  { label: 'Pengguna & Unit', icon: Users, roles: ['owner'] },
  { label: 'Manajemen Menu', icon: Utensils, roles: ['owner'] },
] as const

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [active, setActive] = useState('Dashboard')

  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    let mounted = true
    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return
      if (error) setMessage(error.message)
      setSession(data.session)
      setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (!nextSession) setProfile(null)
    })
    return () => { mounted = false; listener.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!supabase || !session?.user) { setProfile(null); return }
    let alive = true
    supabase.from('user_profiles')
      .select('display_name, role, unit_id, is_active')
      .eq('user_id', session.user.id).maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return
        if (error) setMessage(`Profil belum dapat dibaca: ${error.message}`)
        else if (data) {
          const next = data as Profile
          setProfile(next)
          if (!next.is_active) setMessage('Akun ini dinonaktifkan. Hubungi owner.')
        } else setMessage('Akun berhasil login, tetapi profil belum dibuat. Hubungi Owner.')
      })
    return () => { alive = false }
  }, [session])

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')
    if (!supabase) return
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setMessage(error.message)
  }
  async function handleLogout() {
    if (supabase) await supabase.auth.signOut()
    setSession(null); setProfile(null); setMessage('')
  }

  if (!isSupabaseConfigured) return <SetupScreen />
  if (loading) return <div className="loading-screen"><div className="brand-mark"><Store /></div><p>Menyiapkan Warung Medan…</p></div>
  if (!session) return <LoginScreen email={email} setEmail={setEmail} password={password} setPassword={setPassword} onSubmit={handleLogin} message={message} />

  const role = profile?.role
  const visibleItems = navItems.filter(item => role && (item.roles as readonly string[]).includes(role))
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Store size={22} /></div><div><strong>Warung Medan</strong><span>CT Catering · Terpadu</span></div></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav>{visibleItems.map(item => <button key={item.label} className={`nav-item ${active === item.label ? 'active' : ''}`} onClick={() => setActive(item.label)}><item.icon size={18} /><span>{item.label}</span></button>)}</nav>
      <div className="sidebar-bottom"><div className="secure-note"><ShieldCheck size={17} /><span>Akses mengikuti peran akun</span></div><button className="nav-item logout" onClick={handleLogout}><LogOut size={18} /><span>Keluar</span></button></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="breadcrumb">Warung Medan <span>/</span> <strong>{active}</strong></div><div className="user-chip"><div className="avatar">{(profile?.display_name || session.user.email || 'U').slice(0,1).toUpperCase()}</div><div><strong>{profile?.display_name || session.user.email}</strong><span>{profile?.role ? roleLabels[profile.role] : 'Profil belum lengkap'}</span></div></div></header>
      <section className="content">
        {message && <div className="notice"><Activity size={17} />{message}</div>}
        {active === 'Dashboard'
          ? <Dashboard profile={profile} email={session.user.email || ''} />
          : active === 'Pengguna & Unit' && role === 'owner'
            ? <UsersModule currentUserId={session.user.id} />
            : active === 'Manajemen Menu' && role === 'owner'
              ? <MenuManagementModule />
            : active === 'Kasir & Penjualan' && role && ['owner', 'cashier', 'tenant'].includes(role)
              ? <SalesModule profile={profile} />
            : active === 'Stok Bahan Baku' && role && ['owner', 'cashier', 'kitchen'].includes(role)
              ? <StockModule profile={profile} currentUserId={session.user.id} />
              : active === 'Stok Opname & Audit' && role
                ? <StocktakeModule profile={profile} currentUserId={session.user.id} />
              : active === 'Laporan' && role === 'owner'
                ? <StockReportsModule />
                : <ModulePlaceholder title={active} role={role} />}
        {!profile && <div className="notice warning"><ShieldCheck size={18} /><div><strong>Profil akses belum siap.</strong><p>Jangan gunakan akun ini untuk operasional sampai Owner menetapkan profil dan unit yang benar.</p></div></div>}
      </section>
    </main>
  </div>
}

function UsersModule({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [units, setUnits] = useState<BusinessUnit[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<ManagedUser | null>(null)
  const [permissionUser, setPermissionUser] = useState<ManagedUser | null>(null)
  const [permissionValues, setPermissionValues] = useState<AppPermissions>(defaultPermissions)
  const [permissionSaving, setPermissionSaving] = useState(false)
  const [name, setName] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [role, setRole] = useState<Role>('cashier')
  const [unitId, setUnitId] = useState('')
  const [activeStatus, setActiveStatus] = useState(true)

  async function loadData() {
    if (!supabase) return
    setLoading(true); setError('')
    const [userResult, unitResult] = await Promise.all([
      supabase.functions.invoke('admin-users', { body: { action: 'list' } }),
      supabase.from('business_units').select('id,code,name,kind,is_active').eq('is_active', true).order('name'),
    ])
    let nextUsers: ManagedUser[] = []
    if (userResult.error) setError(`Gagal memuat pengguna: ${userResult.error.message}`)
    else if (userResult.data?.error) setError(`Gagal memuat pengguna: ${userResult.data.error}`)
    else { nextUsers = (userResult.data?.users || []) as ManagedUser[]; setUsers(nextUsers) }
    if (unitResult.error) setError(prev => [prev, `Gagal memuat unit: ${unitResult.error.message}`].filter(Boolean).join(' · '))
    else setUnits((unitResult.data || []) as BusinessUnit[])
    if (nextUsers.length) {
      const permResult = await supabase.from('user_permissions').select('user_id,stock_view,stock_receive,stock_issue,ingredient_manage,sales_create,reports_view,users_manage')
      if (permResult.error) setError(prev => [prev, `Gagal memuat hak akses: ${permResult.error.message}`].filter(Boolean).join(' · '))
      else {
        const rows = (permResult.data || []) as (AppPermissions & { user_id: string })[]
        const selected = permissionUser ? rows.find(row => row.user_id === permissionUser.user_id) : null
        if (selected) setPermissionValues({ stock_view: selected.stock_view, stock_receive: selected.stock_receive, stock_issue: selected.stock_issue, ingredient_manage: selected.ingredient_manage, sales_create: selected.sales_create, reports_view: selected.reports_view, users_manage: selected.users_manage })
        else if (permissionUser) setPermissionValues(defaultPermissions)
      }
    }
    setLoading(false)
  }
  useEffect(() => { void loadData() }, [])

  function resetForm() {
    setShowForm(false); setEditing(null); setName(''); setUserEmail(''); setNewPassword('')
    setRole('cashier'); setUnitId(''); setActiveStatus(true)
  }
  function startCreate() {
    resetForm(); setShowForm(true); setError(''); setSuccess('')
  }
  function startEdit(user: ManagedUser) {
    setEditing(user); setShowForm(true); setError(''); setSuccess('')
    setName(user.display_name || ''); setUserEmail(user.email || '')
    setRole(user.role); setUnitId(user.unit_id || ''); setActiveStatus(user.is_active)
    setNewPassword('')
  }

  async function submitUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setSaving(true); setError(''); setSuccess('')
    const payload = editing
      ? { action: 'update', user_id: editing.user_id, display_name: name.trim(), role, unit_id: role === 'owner' ? null : unitId || null, is_active: activeStatus }
      : { action: 'create', email: userEmail.trim(), password: newPassword, display_name: name.trim(), role, unit_id: role === 'owner' ? null : unitId || null }
    const { data, error: invokeError } = await supabase.functions.invoke('admin-users', { body: payload })
    if (invokeError || data?.error) {
      setError(data?.error || invokeError?.message || 'Permintaan gagal diproses.')
      setSaving(false); return
    }
    setSuccess(editing ? 'Profil pengguna berhasil diperbarui.' : 'Akun pengguna berhasil dibuat.')
    resetForm()
    await loadData()
    setSaving(false)
  }

  async function toggleActive(user: ManagedUser) {
    if (!supabase) return
    if (user.user_id === currentUserId && user.is_active) {
      setError('Owner yang sedang login tidak dapat menonaktifkan akunnya sendiri.')
      return
    }
    const action = user.is_active ? 'menonaktifkan' : 'mengaktifkan'
    if (!window.confirm(`Yakin ${action} akun ${user.display_name || user.email || 'pengguna ini'}?`)) return
    setError(''); setSuccess('')
    const { data, error: invokeError } = await supabase.functions.invoke('admin-users', {
      body: { action: 'update', user_id: user.user_id, display_name: user.display_name || '', role: user.role, unit_id: user.unit_id, is_active: !user.is_active },
    })
    if (invokeError || data?.error) setError(data?.error || invokeError?.message || 'Perubahan status gagal.')
    else { setSuccess(`Akun berhasil ${user.is_active ? 'dinonaktifkan' : 'diaktifkan'}.`); await loadData() }
  }

  const availableUnits = units.filter(unit => role === 'cashier' ? unit.kind === 'branch' : role === 'tenant' || role === 'kitchen' ? unit.kind === 'bazaar' : false)

  async function openPermissions(user: ManagedUser) {
    setPermissionUser(user); setError(''); setSuccess('')
    if (!supabase) return
    const { data, error: permissionError } = await supabase.from('user_permissions').select('stock_view,stock_receive,stock_issue,ingredient_manage,sales_create,reports_view,users_manage').eq('user_id', user.user_id).maybeSingle()
    if (permissionError) { setError(`Gagal membaca hak akses: ${permissionError.message}`); setPermissionValues(defaultPermissions); return }
    setPermissionValues(data ? {
      stock_view: data.stock_view, stock_receive: data.stock_receive, stock_issue: data.stock_issue,
      ingredient_manage: data.ingredient_manage, sales_create: data.sales_create, reports_view: data.reports_view, users_manage: data.users_manage,
    } : defaultPermissions)
  }

  async function savePermissions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !permissionUser) return
    if (permissionUser.role === 'owner') { setError('Hak akses Owner selalu penuh dan tidak dapat dibatasi dari panel ini.'); return }
    setPermissionSaving(true); setError(''); setSuccess('')
    const { error: saveError } = await supabase.from('user_permissions').upsert({
      user_id: permissionUser.user_id, ...permissionValues, updated_by: currentUserId, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    if (saveError) setError(`Gagal menyimpan hak akses: ${saveError.message}`)
    else setSuccess(`Hak akses untuk ${permissionUser.display_name || permissionUser.email || 'pengguna'} berhasil disimpan.`)
    setPermissionSaving(false)
  }

  return <div className="users-page">
    <div className="page-heading">
      <div><p className="eyebrow">ADMINISTRASI AKSES</p><h1>Pengguna & Unit</h1><p className="muted">Kelola akun, peran, unit penugasan, dan status akses karyawan.</p></div>
      <div className="users-heading-actions"><button className="secondary-button" onClick={() => void loadData()} disabled={loading}><RefreshCw size={16} /> Muat ulang</button><button className="primary-button" onClick={startCreate}><UserPlus size={17} /> Tambah pengguna</button></div>
    </div>
    {error && <div className="form-message users-alert">{error}</div>}
    {success && <div className="users-success"><CheckCircle2 size={17} />{success}</div>}
    {showForm && <form className="user-form" onSubmit={submitUser}>
      <div className="user-form-heading"><div><h2>{editing ? 'Edit pengguna' : 'Tambah pengguna baru'}</h2><p className="muted">{editing ? 'Perbarui penugasan dan status akun.' : 'Akun login dan profil akan dibuat sekaligus.'}</p></div><button type="button" className="icon-button" onClick={resetForm} aria-label="Tutup formulir"><X size={18} /></button></div>
      <div className="user-form-grid">
        <label className="field"><span>Nama lengkap</span><input required value={name} onChange={e => setName(e.target.value)} placeholder="Nama karyawan" /></label>
        <label className="field"><span>Email login</span><input required type="email" disabled={Boolean(editing)} value={userEmail} onChange={e => setUserEmail(e.target.value)} placeholder="nama@email.com" />{editing && <small>Email login belum dapat diubah dari modul ini.</small>}</label>
        {!editing && <label className="field"><span>Password awal (minimal 8 karakter)</span><input required minLength={8} type="password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Buat password sementara" /></label>}
        <label className="field"><span>Peran</span><select value={role} onChange={e => { setRole(e.target.value as Role); setUnitId('') }}>
          <option value="cashier">Kasir Cabang</option><option value="tenant">Tim Tenant Bazar</option><option value="kitchen">Tim Dapur Bazar</option><option value="owner">Owner</option>
        </select></label>
        {role !== 'owner' && <label className="field"><span>Unit penugasan</span><select required value={unitId} onChange={e => setUnitId(e.target.value)}><option value="">Pilih unit…</option>{availableUnits.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select><small>Kasir hanya untuk cabang; tenant dan dapur hanya untuk bazar.</small></label>}
        {editing && <label className="field field-check"><input type="checkbox" checked={activeStatus} onChange={e => setActiveStatus(e.target.checked)} /><span>Akun aktif dan boleh login</span></label>}
      </div>
      <div className="form-actions"><button className="primary-button" type="submit" disabled={saving}>{saving ? <LoaderCircle size={16} className="spin" /> : <CheckCircle2 size={16} />}{saving ? 'Menyimpan…' : 'Simpan pengguna'}</button><button type="button" className="secondary-button" onClick={resetForm} disabled={saving}>Batal</button></div>
    </form>}
    {permissionUser && <form className="permission-editor" onSubmit={savePermissions}>
      <div className="permission-editor-heading"><div><p className="eyebrow">KONTROL AKSES</p><h2>Hak akses: {permissionUser.display_name || permissionUser.email || 'Pengguna'}</h2><p className="muted">Peran: {roleLabels[permissionUser.role]} · Unit tetap dibatasi sesuai penugasan.</p></div><button type="button" className="icon-button" onClick={() => setPermissionUser(null)} aria-label="Tutup hak akses"><X size={18} /></button></div>
      <div className="permission-grid">{permissionFields.map(item => <label className="permission-option" key={item.key}><input type="checkbox" checked={permissionValues[item.key]} onChange={e => setPermissionValues(prev => ({ ...prev, [item.key]: e.target.checked }))} /><span className="permission-copy"><strong>{item.label}</strong><small>{item.description}</small></span></label>)}</div>
      <div className="permission-warning"><ShieldCheck size={17} /><span>Prinsip aman: centang hanya izin yang dibutuhkan. Owner tetap memiliki akses penuh; akses lintas unit tidak diberikan oleh checkbox ini.</span></div>
      <div className="form-actions"><button className="primary-button" type="submit" disabled={permissionSaving}>{permissionSaving ? <LoaderCircle size={16} className="spin" /> : <CheckCircle2 size={16} />}{permissionSaving ? 'Menyimpan izin…' : 'Simpan hak akses'}</button><button type="button" className="secondary-button" onClick={() => setPermissionUser(null)} disabled={permissionSaving}>Tutup</button></div>
    </form>}
    <div className="users-summary"><div><strong>{users.length}</strong><span>Total profil</span></div><div><strong>{users.filter(u => u.is_active).length}</strong><span>Akun aktif</span></div><div><strong>{users.filter(u => !u.is_active).length}</strong><span>Nonaktif</span></div></div>
    <div className="users-table-wrap">
      {loading ? <div className="users-empty"><LoaderCircle className="spin" size={20} /> Memuat data pengguna…</div> : users.length === 0 ? <div className="users-empty">Belum ada profil pengguna yang dapat ditampilkan.</div> : <table className="users-table">
        <thead><tr><th>Pengguna</th><th>Peran</th><th>Unit</th><th>Status</th><th>Aksi</th></tr></thead>
        <tbody>{users.map(user => {
          const unit = units.find(u => u.id === user.unit_id)
          return <tr key={user.user_id}>
            <td><strong>{user.display_name || 'Tanpa nama'}</strong><small>{user.email || user.user_id}</small></td>
            <td>{roleLabels[user.role]}</td>
            <td>{user.role === 'owner' ? 'Semua unit' : unit?.name || 'Unit tidak ditemukan'}</td>
            <td><span className={`status-tag ${user.is_active ? 'active' : 'inactive'}`}>{user.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
            <td><div className="row-actions"><button className="small-action" onClick={() => startEdit(user)}><Pencil size={14} /> Edit</button>{user.role !== 'owner' && <button className="small-action" onClick={() => void openPermissions(user)}><ShieldCheck size={14} /> Hak akses</button>}<button className="small-action" onClick={() => void toggleActive(user)} disabled={user.user_id === currentUserId && user.is_active}>{user.is_active ? <><Ban size={14} /> Nonaktifkan</> : <><CheckCircle2 size={14} /> Aktifkan</>}</button></div></td>
          </tr>
        })}</tbody>
      </table>}
    </div>
    <p className="users-footnote"><ShieldCheck size={15} /> Penghapusan permanen tidak disediakan agar jejak transaksi tetap terjaga. Jangan menonaktifkan satu-satunya akun Owner.</p>
  </div>
}



function MenuManagementModule() {
  const [items, setItems] = useState<MenuItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('LAUK')
  const [priceText, setPriceText] = useState('')
  const [sku, setSku] = useState('')
  const [activeStatus, setActiveStatus] = useState(true)
  const [search, setSearch] = useState('')

  async function loadMenu() {
    if (!supabase) return
    setLoading(true)
    setError('')
    const { data, error: loadError } = await supabase
      .from('menu_items')
      .select('id,sku,name,category,sale_price,is_active')
      .order('name')
    if (loadError) setError(`Gagal memuat menu: ${loadError.message}`)
    else setItems((data || []) as MenuItem[])
    setLoading(false)
  }

  useEffect(() => { void loadMenu() }, [])

  function resetForm() {
    setEditingId(null)
    setName('')
    setCategory('LAUK')
    setPriceText('')
    setSku('')
    setActiveStatus(true)
  }

  function startEdit(item: MenuItem) {
    setEditingId(item.id)
    setName(item.name)
    setCategory(item.category || 'LAINNYA')
    setPriceText(String(item.sale_price))
    setSku(item.sku || '')
    setActiveStatus(item.is_active)
    setError('')
    setSuccess('')
  }

  async function saveMenu(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    const parsedPrice = Number(priceText)
    if (!name.trim()) { setError('Nama menu wajib diisi.'); return }
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) { setError('Harga harus lebih besar dari Rp 0.'); return }

    setSaving(true)
    setError('')
    setSuccess('')
    const payload = {
      name: name.trim(),
      category: category.trim() || 'LAINNYA',
      sale_price: parsedPrice,
      sku: sku.trim() || null,
      is_active: activeStatus,
    }
    const result = editingId
      ? await supabase.from('menu_items').update(payload).eq('id', editingId)
      : await supabase.from('menu_items').insert(payload)

    if (result.error) {
      setError(`Menu gagal disimpan: ${result.error.message}`)
      setSaving(false)
      return
    }
    setSuccess(editingId ? 'Menu berhasil diperbarui.' : 'Menu baru berhasil ditambahkan.')
    resetForm()
    await loadMenu()
    setSaving(false)
  }

  async function toggleMenu(item: MenuItem) {
    if (!supabase) return
    const action = item.is_active ? 'menonaktifkan' : 'mengaktifkan'
    if (!window.confirm(`Yakin ${action} menu "${item.name}"?`)) return
    setError('')
    setSuccess('')
    const { error: updateError } = await supabase
      .from('menu_items')
      .update({ is_active: !item.is_active })
      .eq('id', item.id)
    if (updateError) setError(`Status menu gagal diubah: ${updateError.message}`)
    else {
      setSuccess(`Menu "${item.name}" berhasil ${item.is_active ? 'dinonaktifkan' : 'diaktifkan'}.`)
      await loadMenu()
    }
  }

  const filteredItems = items.filter(item =>
    `${item.name} ${item.category || ''} ${item.sku || ''}`.toLowerCase().includes(search.toLowerCase())
  )

  return <div className="users-page">
    <div className="page-heading">
      <div>
        <p className="eyebrow">PENGELOLAAN PRODUK</p>
        <h1>Manajemen Menu</h1>
        <p className="muted">Tambah menu, ubah harga, dan atur menu aktif langsung dari aplikasi.</p>
      </div>
      <button className="secondary-button" onClick={() => void loadMenu()} disabled={loading}>
        <RefreshCw size={16} /> Muat ulang
      </button>
    </div>

    {error && <div className="form-message users-alert">{error}</div>}
    {success && <div className="users-success"><CheckCircle2 size={17} />{success}</div>}

    <form className="user-form" onSubmit={saveMenu}>
      <div className="user-form-heading">
        <div>
          <h2>{editingId ? 'Edit menu' : 'Tambah menu baru'}</h2>
          <p className="muted">Perubahan akan tersimpan ke database dan digunakan pada kasir.</p>
        </div>
        {editingId && <button type="button" className="secondary-button" onClick={resetForm}>Batal edit</button>}
      </div>
      <div className="user-form-grid">
        <label className="field">
          <span>Nama menu</span>
          <input required maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="Contoh: Arsik Ikan Mas" />
        </label>
        <label className="field">
          <span>Kategori</span>
          <select value={category} onChange={e => setCategory(e.target.value)}>
            <option value="LAUK">Lauk</option>
            <option value="MAKANAN">Makanan</option>
            <option value="MINUM">Minuman</option>
            <option value="SNACK">Snack</option>
            <option value="PAKET">Paket</option>
            <option value="LAINNYA">Lainnya</option>
          </select>
        </label>
        <label className="field">
          <span>Harga jual (Rp)</span>
          <input required type="number" min="1" step="1" value={priceText} onChange={e => setPriceText(e.target.value)} placeholder="35000" />
        </label>
        <label className="field">
          <span>Kode menu (opsional)</span>
          <input maxLength={40} value={sku} onChange={e => setSku(e.target.value)} placeholder="Contoh: LAUK-001" />
        </label>
        <label className="field field-check">
          <input type="checkbox" checked={activeStatus} onChange={e => setActiveStatus(e.target.checked)} />
          <span>Menu aktif dan tampil di kasir</span>
        </label>
      </div>
      <div className="form-actions">
        <button className="primary-button" type="submit" disabled={saving}>
          {saving ? <LoaderCircle size={16} className="spin" /> : editingId ? <Pencil size={16} /> : <Plus size={16} />}
          {saving ? 'Menyimpan…' : editingId ? 'Simpan perubahan' : 'Tambah menu'}
        </button>
        {!editingId && <button type="button" className="secondary-button" onClick={resetForm}>Kosongkan</button>}
      </div>
    </form>

    <div className="users-table-wrap">
      <div className="sales-panel-heading" style={{ padding: '18px 20px' }}>
        <div><h2>Daftar menu</h2><p className="muted">{items.length} menu · {items.filter(item => item.is_active).length} aktif</p></div>
        <input className="sales-search" style={{ maxWidth: 300 }} value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari nama/kategori…" aria-label="Cari menu" />
      </div>
      {loading ? <div className="users-empty"><LoaderCircle className="spin" size={20} /> Memuat menu…</div>
        : filteredItems.length === 0 ? <div className="users-empty">Belum ada menu yang cocok.</div>
        : <table className="users-table">
          <thead><tr><th>Menu</th><th>Kategori</th><th>Harga</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody>{filteredItems.map(item => <tr key={item.id}>
            <td><strong>{item.name}</strong><small>{item.sku || 'Tanpa kode'}</small></td>
            <td>{item.category || 'Lainnya'}</td>
            <td><strong>{money(Number(item.sale_price))}</strong></td>
            <td><span className={`status-tag ${item.is_active ? 'active' : 'inactive'}`}>{item.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
            <td><div className="row-actions">
              <button type="button" className="small-action" onClick={() => startEdit(item)}><Pencil size={14} /> Edit</button>
              <button type="button" className="small-action" onClick={() => void toggleMenu(item)}>
                {item.is_active ? <><Ban size={14} /> Nonaktifkan</> : <><CheckCircle2 size={14} /> Aktifkan</>}
              </button>
            </div></td>
          </tr>)}</tbody>
        </table>}
    </div>
    <p className="users-footnote"><ShieldCheck size={15} /> Hanya Owner yang mendapat menu pengelolaan. Menu dinonaktifkan tanpa menghapus riwayat transaksi.</p>
  </div>
}

type Ingredient = {
  id: string
  code: string | null
  name: string
  base_unit: string
  alternate_unit: string | null
  alternate_factor: number | null
  reorder_level: number
  is_active: boolean
}
type StockUnit = { id: string; code: string; name: string; kind: 'branch' | 'bazaar'; is_active: boolean }
type IngredientUnitOption = { ingredient_id: string; unit_name: string; factor_to_base: number; is_active: boolean }
type StockBalance = { unit_id: string; ingredient_id: string; quantity: number; average_unit_cost: number }
type StockMovement = {
  id: string; unit_id: string; ingredient_id: string; kind: string
  quantity_delta: number; unit_cost: number; note: string | null; created_at: string; input_quantity?: number | null; input_unit?: string | null; conversion_factor?: number | null; base_quantity?: number | null
}

function movementLabel(kind: string) {
  const labels: Record<string, string> = {
    opening: 'Stok awal', purchase: 'Stok masuk/pembelian', manual_in: 'Penambahan manual',
    manual_out: 'Pengeluaran manual', transfer_in: 'Transfer masuk',
    transfer_out: 'Transfer keluar', stocktake_adjustment: 'Penyesuaian stok',
    sale_reversal: 'Pembatalan pemakaian',
  }
  return labels[kind] || kind
}
function quantity(value: number, digits = 3) {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: digits }).format(Number(value) || 0)
}

function StockModule({ profile, currentUserId }: { profile: Profile | null; currentUserId: string }) {
  const isOwner = profile?.role === 'owner'
  const [permissions, setPermissions] = useState<AppPermissions>(isOwner ? { stock_view: true, stock_receive: true, stock_issue: true, ingredient_manage: true, sales_create: true, reports_view: true, users_manage: true } : deniedPermissions)
  const [permissionLoading, setPermissionLoading] = useState(!isOwner)
  const canView = isOwner || permissions.stock_view
  const canReceive = isOwner || permissions.stock_receive
  const canIssue = isOwner || permissions.stock_issue
  const canManageIngredients = isOwner || permissions.ingredient_manage
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [units, setUnits] = useState<StockUnit[]>([])
  const [balances, setBalances] = useState<StockBalance[]>([])
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [selectedUnit, setSelectedUnit] = useState(profile?.unit_id || '')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [search, setSearch] = useState('')
  const [editingIngredient, setEditingIngredient] = useState<Ingredient | null>(null)
  const [ingredientName, setIngredientName] = useState('')
  const [ingredientCode, setIngredientCode] = useState('')
  const [baseUnit, setBaseUnit] = useState('kg')
  const [alternateUnit, setAlternateUnit] = useState('')
  const [alternateFactor, setAlternateFactor] = useState('1')
  const [reorderLevel, setReorderLevel] = useState('0')
  const [ingredientActive, setIngredientActive] = useState(true)
  const [movementType, setMovementType] = useState<'in' | 'out'>('in')
  const [movementIngredient, setMovementIngredient] = useState('')
  const [movementQuantity, setMovementQuantity] = useState('')
  const [movementUnit, setMovementUnit] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [movementNote, setMovementNote] = useState('')

  useEffect(() => {
    let alive = true
    async function loadPermissions() {
      if (isOwner) { setPermissions({ stock_view: true, stock_receive: true, stock_issue: true, ingredient_manage: true, sales_create: true, reports_view: true, users_manage: true }); setPermissionLoading(false); return }
      if (!supabase) { setPermissionLoading(false); return }
      setPermissionLoading(true)
      const { data, error: permissionError } = await supabase.from('user_permissions')
        .select('stock_view,stock_receive,stock_issue,ingredient_manage,sales_create,reports_view,users_manage')
        .eq('user_id', currentUserId).maybeSingle()
      if (!alive) return
      if (permissionError) {
        setPermissions(deniedPermissions)
        setError(`Gagal memuat hak akses stok: ${permissionError.message}`)
      } else if (data) setPermissions(data as AppPermissions)
      else setPermissions(deniedPermissions)
      setPermissionLoading(false)
    }
    void loadPermissions()
    return () => { alive = false }
  }, [isOwner, currentUserId])

  useEffect(() => {
    if (!canReceive && canIssue) setMovementType('out')
    else if (canReceive && !canIssue) setMovementType('in')
  }, [canReceive, canIssue])

  async function loadStock() {
    if (!supabase) return
    setLoading(true)
    setError('')
    const [ingredientResult, unitResult] = await Promise.all([
      supabase.from('ingredients').select('id,code,name,base_unit,alternate_unit,alternate_factor,reorder_level,is_active').order('name'),
      supabase.from('business_units').select('id,code,name,kind,is_active').eq('is_active', true).order('name'),
    ])
    if (ingredientResult.error) setError(`Gagal memuat bahan: ${ingredientResult.error.message}`)
    else setIngredients((ingredientResult.data || []) as Ingredient[])
    if (unitResult.error) setError(prev => [prev, `Gagal memuat unit: ${unitResult.error.message}`].filter(Boolean).join(' · '))
    else {
      const loadedUnits = (unitResult.data || []) as StockUnit[]
      setUnits(loadedUnits)
      if (profile?.unit_id) setSelectedUnit(profile.unit_id)
      else if (!selectedUnit && loadedUnits.length) setSelectedUnit(loadedUnits[0].id)
    }
    setLoading(false)
  }

  async function loadUnitStock(unitId: string) {
    if (!supabase || !unitId) { setBalances([]); setMovements([]); return }
    const [balanceResult, movementResult] = await Promise.all([
      supabase.from('inventory_balances').select('unit_id,ingredient_id,quantity,average_unit_cost').eq('unit_id', unitId),
      supabase.from('inventory_movements').select('id,unit_id,ingredient_id,kind,quantity_delta,unit_cost,note,created_at,input_quantity,input_unit,conversion_factor,base_quantity').eq('unit_id', unitId).order('created_at', { ascending: false }).limit(40),
    ])
    if (balanceResult.error) setError(prev => [prev, `Gagal memuat saldo: ${balanceResult.error.message}`].filter(Boolean).join(' · '))
    else setBalances((balanceResult.data || []) as StockBalance[])
    if (movementResult.error) setError(prev => [prev, `Gagal memuat riwayat: ${movementResult.error.message}`].filter(Boolean).join(' · '))
    else setMovements((movementResult.data || []) as StockMovement[])
  }

  useEffect(() => { if (canView) void loadStock(); else setLoading(false) }, [profile?.unit_id, canView])
  useEffect(() => { if (canView && selectedUnit) void loadUnitStock(selectedUnit) }, [selectedUnit, canView])

  function resetIngredientForm() {
    setEditingIngredient(null); setIngredientName('')
    setIngredientCode(''); setBaseUnit('kg'); setAlternateUnit(''); setAlternateFactor('1'); setReorderLevel('0'); setIngredientActive(true)
  }
  function editIngredient(item: Ingredient) {
    setEditingIngredient(item); setIngredientName(item.name)
    setIngredientCode(item.code || ''); setBaseUnit(item.base_unit); setAlternateUnit(item.alternate_unit || ''); setAlternateFactor(String(item.alternate_factor || 1)); setReorderLevel(String(item.reorder_level))
    setIngredientActive(item.is_active); setError(''); setSuccess('')
  }

  async function saveIngredient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !canManageIngredients) return
    const level = Number(reorderLevel)
    if (!ingredientName.trim() || !baseUnit.trim()) { setError('Nama bahan dan satuan wajib diisi.'); return }
    if (!Number.isFinite(level) || level < 0) { setError('Batas minimum stok tidak valid.'); return }
    const factor = Number(alternateFactor)
    if (alternateUnit.trim() && (!Number.isFinite(factor) || factor <= 0)) { setError('Konversi satuan alternatif harus lebih besar dari nol.'); return }
    if (alternateUnit.trim() && alternateUnit.trim().toLowerCase() === baseUnit.trim().toLowerCase()) { setError('Satuan alternatif harus berbeda dari satuan dasar.'); return }
    setSaving(true); setError(''); setSuccess('')
    const payload = {
      name: ingredientName.trim(), code: ingredientCode.trim() || null,
      base_unit: baseUnit.trim(), alternate_unit: alternateUnit.trim() || null, alternate_factor: alternateUnit.trim() ? factor : null, reorder_level: level, is_active: ingredientActive,
    }
    const result = editingIngredient
      ? await supabase.from('ingredients').update(payload).eq('id', editingIngredient.id)
      : await supabase.from('ingredients').insert(payload)
    if (result.error) setError(`Bahan gagal disimpan: ${result.error.message}`)
    else {
      setSuccess(editingIngredient ? 'Bahan baku berhasil diperbarui.' : 'Bahan baku berhasil ditambahkan.')
      resetIngredientForm()
      await loadStock()
    }
    setSaving(false)
  }

  async function toggleIngredient(item: Ingredient) {
    if (!supabase || !canManageIngredients) return
    if (!window.confirm(`Yakin ${item.is_active ? 'menonaktifkan' : 'mengaktifkan'} bahan "${item.name}"?`)) return
    setError(''); setSuccess('')
    const { error: updateError } = await supabase.from('ingredients').update({ is_active: !item.is_active }).eq('id', item.id)
    if (updateError) setError(`Status bahan gagal diubah: ${updateError.message}`)
    else { setSuccess(`Bahan "${item.name}" berhasil ${item.is_active ? 'dinonaktifkan' : 'diaktifkan'}.`); await loadStock() }
  }

  async function postMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    if (movementType === 'in' && !canReceive) { setError('Akun ini tidak memiliki izin stok masuk.'); return }
    if (movementType === 'out' && !canIssue) { setError('Akun ini tidak memiliki izin stok keluar.'); return }
    const qty = Number(movementQuantity)
    const selectedIngredient = ingredients.find(item => item.id === movementIngredient)
    const inputUnit = movementUnit || selectedIngredient?.base_unit || ''
    const factor = inputUnit === selectedIngredient?.alternate_unit ? Number(selectedIngredient?.alternate_factor || 0) : 1
    const cost = movementType === 'in' ? Number(unitCost || 0) : 0
    if (!selectedUnit) { setError('Pilih unit stok terlebih dahulu.'); return }
    if (!movementIngredient) { setError('Pilih bahan baku.'); return }
    if (!Number.isFinite(qty) || qty <= 0) { setError('Jumlah harus lebih besar dari nol.'); return }
    if (!selectedIngredient || !inputUnit || !Number.isFinite(factor) || factor <= 0) { setError('Konfigurasi satuan bahan belum valid.'); return }
    if (movementType === 'out' && !movementNote.trim()) { setError('Alasan stok keluar wajib diisi.'); return }
    if (movementType === 'in' && (!Number.isFinite(cost) || cost < 0)) { setError('Harga beli per satuan tidak valid.'); return }
    setSaving(true); setError(''); setSuccess('')
    const requestId = crypto.randomUUID()
    const result = movementType === 'in'
      ? await supabase.rpc('receive_stock_converted', {
          p_unit_id: selectedUnit, p_ingredient_id: movementIngredient,
          p_input_quantity: qty, p_input_unit: inputUnit, p_unit_cost: cost, p_note: movementNote.trim() || null, p_request_id: requestId,
        })
      : await supabase.rpc('issue_stock_converted', {
          p_unit_id: selectedUnit, p_ingredient_id: movementIngredient,
          p_input_quantity: qty, p_input_unit: inputUnit, p_note: movementNote.trim(), p_request_id: requestId,
        })
    if (result.error) setError(`Stok gagal disimpan: ${result.error.message}`)
    else {
      setSuccess(movementType === 'in' ? 'Stok masuk berhasil dicatat.' : 'Stok keluar berhasil dicatat.')
      setMovementQuantity(''); setUnitCost(''); setMovementNote('')
      await loadUnitStock(selectedUnit)
    }
    setSaving(false)
  }

  const filteredIngredients = ingredients.filter(item =>
    `${item.name} ${item.code || ''} ${item.base_unit}`.toLowerCase().includes(search.toLowerCase()))
  const selectedUnitInfo = units.find(unit => unit.id === selectedUnit)
  const balanceFor = (ingredientId: string) => balances.find(balance => balance.ingredient_id === ingredientId)
  const activeIngredients = ingredients.filter(item => item.is_active)
  const selectedIngredientForMovement = activeIngredients.find(item => item.id === movementIngredient)
  const movementUnitOptions = selectedIngredientForMovement ? [selectedIngredientForMovement.base_unit, ...(selectedIngredientForMovement.alternate_unit ? [selectedIngredientForMovement.alternate_unit] : [])] : []

  if (permissionLoading) return <div className="placeholder-card"><LoaderCircle className="spin" size={22} /><h1>Memeriksa hak akses stok…</h1></div>
  if (!canView) return <div className="placeholder-card"><div className="module-icon"><ShieldCheck size={23} /></div><p className="eyebrow">AKSES TERBATAS</p><h1>Stok Bahan Baku</h1><p className="muted">Akun ini belum diberi izin untuk melihat stok. Hubungi Owner jika akses diperlukan.</p></div>

  return <div className="users-page">
    <div className="page-heading">
      <div><p className="eyebrow">PERSEDIAAN OPERASIONAL</p><h1>Stok Bahan Baku</h1><p className="muted">Kelola bahan, catat stok masuk dan keluar secara manual, serta pantau saldo per unit.</p></div>
      <button type="button" className="secondary-button" onClick={async () => { await loadStock(); await loadUnitStock(selectedUnit) }} disabled={loading}><RefreshCw size={16} /> Muat ulang</button>
    </div>
    {error && <div className="form-message users-alert">{error}</div>}
    {success && <div className="users-success"><CheckCircle2 size={17} />{success}</div>}

    <section className="user-form">
      <div className="user-form-heading"><div><h2>Saldo per unit</h2><p className="muted">Pilih lokasi persediaan yang ingin diperiksa.</p></div></div>
      <label className="field sales-unit-field"><span>Unit stok</span>
        <select value={selectedUnit} disabled={!isOwner} onChange={e => setSelectedUnit(e.target.value)}>
          <option value="">Pilih unit…</option>
          {units.filter(unit => isOwner || unit.id === profile?.unit_id).map(unit => <option key={unit.id} value={unit.id}>{unit.name} · {unit.kind === 'branch' ? 'Cabang' : 'Bazar'}</option>)}
        </select>
      </label>
      {!isOwner && <p className="users-footnote">Akses stok dibatasi pada unit yang ditetapkan untuk akun ini.</p>}
    </section>

    {(canReceive || canIssue) && <form className="user-form" onSubmit={postMovement}>
      <div className="user-form-heading"><div><h2>Catat pergerakan stok</h2><p className="muted">Stok tidak berkurang otomatis saat menu terjual.</p></div></div>
      <div className="user-form-grid">
        <label className="field"><span>Jenis transaksi</span><select value={movementType} onChange={e => setMovementType(e.target.value as 'in' | 'out')}><>{canReceive && <option value="in">Stok masuk / pembelian</option>}{canIssue && <option value="out">Stok keluar manual</option>}</></select></label>
        <label className="field"><span>Bahan baku</span><select required value={movementIngredient} onChange={e => { const id = e.target.value; setMovementIngredient(id); const item = activeIngredients.find(i => i.id === id); setMovementUnit(item?.base_unit || '') }}><option value="">Pilih bahan…</option>{activeIngredients.map(item => <option key={item.id} value={item.id}>{item.name} ({item.base_unit}{item.alternate_unit ? ` / ${item.alternate_unit}` : ''})</option>)}</select></label>
        <label className="field"><span>Satuan pembelian / transaksi</span><select value={movementUnit} onChange={e => setMovementUnit(e.target.value)} disabled={!selectedIngredientForMovement}>{movementUnitOptions.map(unit => <option key={unit} value={unit}>{unit}</option>)}</select></label>
        <label className="field"><span>Jumlah ({movementUnit || selectedIngredientForMovement?.base_unit || 'satuan'})</span><input required type="number" min="0.0001" step="0.0001" value={movementQuantity} onChange={e => setMovementQuantity(e.target.value)} placeholder="Contoh: 5" /></label>
        {selectedIngredientForMovement?.alternate_unit && movementUnit === selectedIngredientForMovement.alternate_unit && <p className="muted">Konversi: 1 {selectedIngredientForMovement.alternate_unit} = {quantity(Number(selectedIngredientForMovement.alternate_factor || 0))} {selectedIngredientForMovement.base_unit}. Stok tetap disimpan dalam satuan dasar.</p>}
        {movementType === 'in' && <label className="field"><span>Harga beli per {movementUnit || selectedIngredientForMovement?.base_unit || "satuan"} (Rp)</span><input type="number" min="0" step="1" value={unitCost} onChange={e => setUnitCost(e.target.value)} placeholder={`Contoh: harga untuk 1 ${movementUnit || selectedIngredientForMovement?.base_unit || "satuan"}`} /><small>Masukkan harga total untuk 1 satuan input yang dipilih di atas. Contoh: pilih kg, isi harga per kg; pilih botol, isi harga per botol.</small></label>}
        <label className="field"><span>{movementType === 'in' ? 'Catatan (opsional)' : 'Alasan stok keluar (wajib)'}</span><input value={movementNote} onChange={e => setMovementNote(e.target.value)} required={movementType === 'out'} placeholder={movementType === 'in' ? 'Contoh: pembelian dari pemasok' : 'Contoh: bahan rusak / pemakaian dapur'} /></label>
      </div>
      <div className="form-actions"><button className="primary-button" type="submit" disabled={saving || loading || !selectedUnit || !activeIngredients.length}>{saving ? <LoaderCircle size={16} className="spin" /> : <CheckCircle2 size={16} />}{saving ? 'Menyimpan…' : movementType === 'in' ? 'Simpan stok masuk' : 'Simpan stok keluar'}</button></div>
    </form>}

    {canManageIngredients && <form className="user-form" onSubmit={saveIngredient}>
      <div className="user-form-heading"><div><h2>{editingIngredient ? 'Edit bahan baku' : 'Tambah bahan baku'}</h2><p className="muted">Master bahan dikelola Owner dan tersedia untuk semua unit.</p></div>{editingIngredient && <button type="button" className="secondary-button" onClick={resetIngredientForm}>Batal edit</button>}</div>
      <div className="user-form-grid">
        <label className="field"><span>Nama bahan</span><input required maxLength={120} value={ingredientName} onChange={e => setIngredientName(e.target.value)} placeholder="Contoh: Beras" /></label>
        <label className="field"><span>Kode bahan (opsional)</span><input maxLength={40} value={ingredientCode} onChange={e => setIngredientCode(e.target.value)} placeholder="Contoh: BB-001" /></label>
        <label className="field"><span>Satuan dasar (unit stok)</span><select value={baseUnit} onChange={e => setBaseUnit(e.target.value)}><option value="kg">Kilogram (kg)</option><option value="gram">Gram</option><option value="liter">Liter</option><option value="ml">Mililiter (ml)</option><option value="pcs">Buah / pcs</option><option value="botol">Botol</option><option value="ikat">Ikat</option><option value="pack">Pack</option><option value="dus">Dus</option></select></label>
        <label className="field"><span>Satuan pembelian alternatif (opsional)</span><input maxLength={30} value={alternateUnit} onChange={e => setAlternateUnit(e.target.value)} placeholder="Contoh: kg, dus, botol" /><small>Isi jika bahan bisa dibeli dengan satuan berbeda dari satuan stok dasar.</small></label>
        <label className="field"><span>Isi 1 satuan pembelian dalam satuan stok dasar</span><input type="number" min="0.0001" step="0.0001" value={alternateFactor} onChange={e => setAlternateFactor(e.target.value)} disabled={!alternateUnit.trim()} /><small>Artinya: 1 {alternateUnit.trim() || "satuan alternatif"} = {alternateUnit.trim() ? alternateFactor || "…" : "—"} {baseUnit}. Contoh: 1 kg = 40 botol.</small></label>
        <label className="field"><span>Batas minimum stok</span><input required type="number" min="0" step="0.001" value={reorderLevel} onChange={e => setReorderLevel(e.target.value)} /></label>
        {editingIngredient && <label className="field field-check"><input type="checkbox" checked={ingredientActive} onChange={e => setIngredientActive(e.target.checked)} /><span>Bahan aktif</span></label>}
      </div>
      <div className="form-actions"><button className="primary-button" type="submit" disabled={saving}>{saving ? <LoaderCircle size={16} className="spin" /> : editingIngredient ? <Pencil size={16} /> : <Plus size={16} />}{saving ? 'Menyimpan…' : editingIngredient ? 'Simpan perubahan' : 'Tambah bahan'}</button><button type="button" className="secondary-button" onClick={resetIngredientForm}>Kosongkan</button></div>
    </form>}

    <div className="users-table-wrap">
      <div className="sales-panel-heading" style={{ padding: '18px 20px' }}>
        <div><h2>Daftar bahan dan saldo</h2><p className="muted">{ingredients.length} bahan · {activeIngredients.length} aktif</p></div>
        <input className="sales-search" style={{ maxWidth: 300 }} value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari nama/kode bahan…" aria-label="Cari bahan" />
      </div>
      {loading ? <div className="users-empty"><LoaderCircle className="spin" size={20} /> Memuat stok…</div>
        : filteredIngredients.length === 0 ? <div className="users-empty">Belum ada bahan baku. Owner dapat menambahkan bahan di formulir atas.</div>
        : <table className="users-table"><thead><tr><th>Bahan</th><th>Satuan</th><th>Saldo unit terpilih</th><th>Minimum</th><th>Status</th>{canManageIngredients && <th>Aksi</th>}</tr></thead>
          <tbody>{filteredIngredients.map(item => {
            const balance = balanceFor(item.id)
            const qty = Number(balance?.quantity || 0)
            const low = item.is_active && qty <= Number(item.reorder_level)
            return <tr key={item.id}>
              <td><strong>{item.name}</strong><small>{item.code || 'Tanpa kode'}</small></td>
              <td>{item.base_unit}{item.alternate_unit && <small>1 {item.alternate_unit} = {quantity(Number(item.alternate_factor || 0))} {item.base_unit}</small>}</td>
              <td><strong>{quantity(qty)} {item.base_unit}</strong>{balance && Number(balance.average_unit_cost) > 0 && <small>Rata-rata {money(Number(balance.average_unit_cost))}/{item.base_unit}</small>}</td>
              <td>{quantity(Number(item.reorder_level))} {item.base_unit}</td>
              <td><span className={`status-tag ${!item.is_active ? 'inactive' : low ? 'inactive' : 'active'}`}>{!item.is_active ? 'Nonaktif' : low ? 'Stok rendah' : 'Aktif'}</span></td>
              {canManageIngredients && <td><div className="row-actions"><button type="button" className="small-action" onClick={() => editIngredient(item)}><Pencil size={14} /> Edit</button><button type="button" className="small-action" onClick={() => void toggleIngredient(item)}>{item.is_active ? <><Ban size={14} /> Nonaktifkan</> : <><CheckCircle2 size={14} /> Aktifkan</>}</button></div></td>}
            </tr>
          })}</tbody>
        </table>}
    </div>

    <div className="users-table-wrap">
      <div className="sales-panel-heading" style={{ padding: '18px 20px' }}><div><h2>Riwayat pergerakan stok</h2><p className="muted">40 catatan terbaru untuk {selectedUnitInfo?.name || 'unit terpilih'}.</p></div></div>
      {!selectedUnit ? <div className="users-empty">Pilih unit untuk melihat riwayat.</div>
        : movements.length === 0 ? <div className="users-empty">Belum ada riwayat stok untuk unit ini.</div>
        : <table className="users-table"><thead><tr><th>Waktu</th><th>Bahan</th><th>Jenis</th><th>Perubahan</th><th>Catatan</th></tr></thead>
          <tbody>{movements.map(move => {
            const item = ingredients.find(i => i.id === move.ingredient_id)
            return <tr key={move.id}><td>{new Date(move.created_at).toLocaleString('id-ID')}</td><td><strong>{item?.name || 'Bahan tidak ditemukan'}</strong></td><td>{movementLabel(move.kind)}</td><td><strong>{Number(move.quantity_delta) > 0 ? '+' : ''}{quantity(Number(move.quantity_delta))} {item?.base_unit || ''}</strong>{move.input_quantity != null && move.input_unit && <small>Input: {quantity(Number(move.input_quantity))} {move.input_unit}{Number(move.conversion_factor || 1) !== 1 ? ` × ${quantity(Number(move.conversion_factor))}` : ''}</small>}</td><td>{move.note || '—'}</td></tr>
          })}</tbody>
        </table>}
    </div>
    <p className="users-footnote"><ShieldCheck size={15} /> Penjualan tidak mengurangi stok otomatis. Pengeluaran stok wajib memiliki alasan dan saldo tidak boleh negatif.</p>
  </div>
}


type MenuItem = { id: string; sku: string | null; name: string; category: string | null; sale_price: number; is_active: boolean }
type SaleCartItem = { menu: MenuItem; quantity: number }
type SaleUnit = { id: string; code: string; name: string; kind: 'branch' | 'bazaar'; is_active: boolean }

function money(value: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value || 0)
}

function SalesModule({ profile }: { profile: Profile | null }) {
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [units, setUnits] = useState<SaleUnit[]>([])
  const [selectedUnit, setSelectedUnit] = useState(profile?.unit_id || '')
  const [cart, setCart] = useState<SaleCartItem[]>([])
  const [payment, setPayment] = useState<'cash' | 'bank_transfer' | 'qris' | 'debit' | 'other'>('cash')
  const [discountText, setDiscountText] = useState('0')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [lastReceipt, setLastReceipt] = useState<{ sale_id: string; subtotal?: number; total?: number; status?: string } | null>(null)
  const [search, setSearch] = useState('')

  const isOwner = profile?.role === 'owner'
  const discount = Math.max(0, Number(discountText) || 0)
  const subtotal = cart.reduce((sum, item) => sum + Number(item.menu.sale_price) * item.quantity, 0)
  const total = Math.max(0, subtotal - discount)
  const activeUnit = units.find(unit => unit.id === selectedUnit)
  const visibleMenu = menu.filter(item => `${item.name} ${item.category || ''} ${item.sku || ''}`.toLowerCase().includes(search.toLowerCase()))

  async function loadSalesData() {
    if (!supabase) return
    setLoading(true)
    setError('')
    const menuPromise = supabase.from('menu_items')
      .select('id,sku,name,category,sale_price,is_active')
      .eq('is_active', true)
      .order('name')
    const unitsPromise = supabase.from('business_units')
      .select('id,code,name,kind,is_active')
      .eq('is_active', true)
      .order('name')
    const [menuResult, unitResult] = await Promise.all([menuPromise, unitsPromise])
    if (menuResult.error) setError(`Gagal memuat menu: ${menuResult.error.message}`)
    else setMenu((menuResult.data || []) as MenuItem[])
    if (unitResult.error) setError(prev => [prev, `Gagal memuat unit: ${unitResult.error.message}`].filter(Boolean).join(' · '))
    else {
      const loadedUnits = (unitResult.data || []) as SaleUnit[]
      setUnits(loadedUnits)
      if (profile?.unit_id) setSelectedUnit(profile.unit_id)
      else if (!selectedUnit && loadedUnits.length === 1) setSelectedUnit(loadedUnits[0].id)
    }
    setLoading(false)
  }

  useEffect(() => { void loadSalesData() }, [profile?.unit_id])

  function addItem(item: MenuItem) {
    setCart(current => {
      const existing = current.find(row => row.menu.id === item.id)
      return existing
        ? current.map(row => row.menu.id === item.id ? { ...row, quantity: row.quantity + 1 } : row)
        : [...current, { menu: item, quantity: 1 }]
    })
    setSuccess('')
    setLastReceipt(null)
  }

  function changeQuantity(menuId: string, delta: number) {
    setCart(current => current
      .map(row => row.menu.id === menuId ? { ...row, quantity: Math.max(0, row.quantity + delta) } : row)
      .filter(row => row.quantity > 0))
    setSuccess('')
    setLastReceipt(null)
  }

  async function submitSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess('')
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


type StocktakeDraftItem = { ingredient_id: string; input_quantity: string; input_unit: string }

type StocktakeHeader = {
  id: string; unit_id: string; status: 'pending' | 'approved' | 'rejected' | 'stale';
  notes: string | null; submitted_at: string; submitted_by: string;
  reviewed_at: string | null; review_note: string | null;
}
type StocktakeItemRow = {
  id: string; stocktake_id: string; ingredient_id: string;
  system_quantity: number; counted_base_quantity: number; variance_quantity: number;
  base_unit: string; input_quantity: number; input_unit: string; conversion_factor: number;
}

function StocktakeModule({ profile, currentUserId }: { profile: Profile | null; currentUserId: string }) {
  const isOwner = profile?.role === 'owner'
  const [units, setUnits] = useState<StockUnit[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [ingredientUnits, setIngredientUnits] = useState<IngredientUnitOption[]>([])
  const [unitId, setUnitId] = useState(profile?.unit_id || '')
  const [draft, setDraft] = useState<Record<string, StocktakeDraftItem>>({})
  const [notes, setNotes] = useState('')
  const [headers, setHeaders] = useState<StocktakeHeader[]>([])
  const [detail, setDetail] = useState<StocktakeHeader | null>(null)
  const [detailItems, setDetailItems] = useState<StocktakeItemRow[]>([])
  const [reviewNote, setReviewNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function loadData() {
    if (!supabase) return
    setLoading(true); setError('')
    const [u, i, iu, h] = await Promise.all([
      supabase.from('business_units').select('id,code,name,kind,is_active').eq('is_active', true).order('name'),
      supabase.from('ingredients').select('id,code,name,base_unit,alternate_unit,alternate_factor,reorder_level,is_active').eq('is_active', true).order('name'),
      supabase.from('ingredient_units').select('ingredient_id,unit_name,factor_to_base,is_active').eq('is_active', true).order('unit_name'),
      supabase.from('stocktakes').select('id,unit_id,status,notes,submitted_at,submitted_by,reviewed_at,review_note').order('submitted_at', { ascending: false }).limit(100),
    ])
    if (u.error) setError(`Gagal memuat unit: ${u.error.message}`)
    else {
      const allUnits = (u.data || []) as StockUnit[]
      setUnits(allUnits)
      if (profile?.unit_id) setUnitId(profile.unit_id)
      else if (!unitId && allUnits.length) setUnitId(allUnits[0].id)
    }
    if (i.error) setError(prev => [prev, `Gagal memuat bahan: ${i.error.message}`].filter(Boolean).join(' · '))
    else {
      const list = (i.data || []) as Ingredient[]
      setIngredients(list)
      setDraft(prev => {
        const next = { ...prev }
        for (const item of list) if (!next[item.id]) next[item.id] = { ingredient_id: item.id, input_quantity: '', input_unit: item.base_unit }
        return next
      })
    }
    if (iu.error) setError(prev => [prev, `Gagal memuat satuan konversi: ${iu.error.message}`].filter(Boolean).join(' · '))
    else setIngredientUnits((iu.data || []) as IngredientUnitOption[])
    if (h.error) setError(prev => [prev, `Gagal memuat pengajuan opname: ${h.error.message}`].filter(Boolean).join(' · '))
    else setHeaders((h.data || []) as StocktakeHeader[])
    setLoading(false)
  }

  useEffect(() => { void loadData() }, [currentUserId])

  async function openDetail(header: StocktakeHeader) {
    if (!supabase) return
    setError(''); setSuccess(''); setDetail(header); setReviewNote('')
    const { data, error: e } = await supabase.from('stocktake_items')
      .select('id,stocktake_id,ingredient_id,system_quantity,counted_base_quantity,variance_quantity,base_unit,input_quantity,input_unit,conversion_factor')
      .eq('stocktake_id', header.id).order('created_at')
    if (e) { setError(`Gagal memuat rincian opname: ${e.message}`); setDetailItems([]) }
    else setDetailItems((data || []) as StocktakeItemRow[])
  }

  function getStocktakeFactor(item: Ingredient, inputUnit: string): number {
    const normalizedUnit = inputUnit.trim().toLowerCase()
    if (!normalizedUnit) return 0
    if (normalizedUnit === item.base_unit.trim().toLowerCase()) return 1

    const configuredUnit = ingredientUnits.find(unit =>
      unit.ingredient_id === item.id &&
      unit.unit_name.trim().toLowerCase() === normalizedUnit
    )
    if (configuredUnit) {
      const factor = Number(configuredUnit.factor_to_base)
      return Number.isFinite(factor) && factor > 0 ? factor : 0
    }

    if (item.alternate_unit && normalizedUnit === item.alternate_unit.trim().toLowerCase()) {
      const factor = Number(item.alternate_factor)
      return Number.isFinite(factor) && factor > 0 ? factor : 0
    }
    return 0
  }

  async function submitOpname(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !unitId) {
      setError('Pilih unit stok sebelum mengajukan opname.')
      return
    }

    const items: {
      ingredient_id: string
      input_quantity: number
      input_unit: string
      conversion_factor: number
      base_unit: string
    }[] = []

    for (const item of ingredients) {
      const row = draft[item.id]
      if (!row || row.input_quantity.trim() === '') continue

      const inputQty = Number(row.input_quantity)
      const inputUnit = row.input_unit.trim() || item.base_unit
      if (!Number.isFinite(inputQty) || inputQty < 0) {
        setError(`Jumlah fisik untuk ${item.name} tidak valid. Masukkan angka nol atau lebih.`)
        return
      }

      const factor = getStocktakeFactor(item, inputUnit)
      if (!Number.isFinite(factor) || factor <= 0) {
        setError(`Konversi satuan untuk ${item.name} (${inputUnit}) belum valid. Periksa satuan dasar atau konversi bahan di Stok Bahan Baku.`)
        return
      }

      items.push({
        ingredient_id: item.id,
        input_quantity: inputQty,
        input_unit: inputUnit,
        conversion_factor: factor,
        base_unit: item.base_unit,
      })
    }

    if (!items.length) {
      setError('Isi jumlah fisik minimal satu bahan. Gunakan 0 jika stok fisiknya benar-benar kosong.')
      return
    }

    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const { data, error: submitError } = await supabase.rpc('submit_stocktake', {
        p_unit_id: unitId,
        p_items: items,
        p_notes: notes.trim() || null,
      })
      if (submitError) {
        setError(`Pengajuan opname gagal: ${submitError.message}`)
        return
      }

      setSuccess(`Pengajuan opname berhasil dibuat (${String(data).slice(0, 8)}…). Saldo belum berubah sampai Owner menyetujui.`)
      setNotes('')
      setDraft(Object.fromEntries(ingredients.map(item => [item.id, {
        ingredient_id: item.id,
        input_quantity: '',
        input_unit: item.base_unit,
      }])))
      await loadData()
    } catch (err) {
      setError(`Pengajuan opname gagal: ${err instanceof Error ? err.message : 'Terjadi kesalahan yang tidak diketahui.'}`)
    } finally {
      setSaving(false)
    }
  }

  async function review(approve: boolean) {
    if (!supabase || !detail) return
    if (reviewNote.trim().length < 3) { setError('Catatan Owner wajib diisi, minimal 3 karakter.'); return }
    if (!window.confirm(approve ? 'Setujui koreksi stok ini? Saldo akan berubah jika masih cocok dengan snapshot.' : 'Tolak pengajuan opname ini?')) return
    setSaving(true); setError(''); setSuccess('')
    const { data, error: e } = await supabase.rpc('review_stocktake', {
      p_stocktake_id: detail.id, p_approve: approve, p_review_note: reviewNote.trim(),
    })
    if (e) setError(`Review gagal: ${e.message}`)
    else {
      const result = data as { status?: string; message?: string } | null
      if (result?.status === 'stale') {
        setError(result.message || 'Saldo berubah sejak pengajuan. Silakan lakukan opname ulang.')
        setDetail(null); setDetailItems([])
      } else if (result?.status === 'rejected' || (!approve && result?.status !== 'approved')) {
        setSuccess('Pengajuan opname ditolak.')
        setDetail(null); setDetailItems([])
      } else if (result?.status === 'approved') {
        setSuccess('Opname disetujui. Koreksi saldo dan riwayat stok telah diproses.')
        setDetail(null); setDetailItems([])
      } else {
        setError('Respons review tidak dikenali. Muat ulang riwayat untuk memastikan statusnya.')
      }
      await loadData()
    }
    setSaving(false)
  }

  const statusText: Record<StocktakeHeader['status'], string> = {
    pending: 'Menunggu Owner', approved: 'Disetujui', rejected: 'Ditolak', stale: 'Perlu opname ulang',
  }
  const unitName = (id: string) => units.find(u => u.id === id)?.name || 'Unit tidak ditemukan'
  const ingredientName = (id: string) => ingredients.find(i => i.id === id)?.name || 'Bahan tidak ditemukan'

  return <div className="users-page">
    <div className="page-heading">
      <div><p className="eyebrow">KONTROL PERSEDIAAN</p><h1>Stok Opname & Audit Selisih</h1>
        <p className="muted">Bandingkan hitungan fisik dengan saldo sistem. Pengajuan tidak mengubah saldo sebelum disetujui Owner.</p></div>
      <button className="secondary-button" type="button" onClick={() => void loadData()} disabled={loading}><RefreshCw size={16}/> Muat ulang</button>
    </div>
    {error && <div className="form-message users-alert">{error}</div>}
    {success && <div className="users-success"><CheckCircle2 size={17}/>{success}</div>}

    {!detail && <form className="user-form" onSubmit={submitOpname}>
      <div className="user-form-heading"><div><h2>Ajukan hitung fisik</h2><p className="muted">Kosongkan bahan yang tidak dihitung. Isi 0 jika benar-benar tidak ada stok.</p></div></div>
      <div className="user-form-grid">
        <label className="field"><span>Unit yang dihitung</span><select value={unitId} disabled={!isOwner} required onChange={e => setUnitId(e.target.value)}>
          <option value="">Pilih unit…</option>{units.filter(u => isOwner || u.id === profile?.unit_id).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select></label>
        <label className="field"><span>Catatan opname</span><input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Contoh: opname akhir shift" maxLength={500}/></label>
      </div>
      <div className="users-table-wrap">
        <table className="users-table"><thead><tr><th>Bahan</th><th>Satuan hitung</th><th>Jumlah fisik</th><th>Konversi ke stok dasar</th></tr></thead>
          <tbody>{ingredients.map(item => {
            const row = draft[item.id] || { ingredient_id: item.id, input_quantity: '', input_unit: item.base_unit }
            const availableUnits: IngredientUnitOption[] = [
              { ingredient_id: item.id, unit_name: item.base_unit, factor_to_base: 1, is_active: true },
              ...(item.alternate_unit && Number(item.alternate_factor) > 0
                ? [{ ingredient_id: item.id, unit_name: item.alternate_unit, factor_to_base: Number(item.alternate_factor), is_active: true }]
                : []),
              ...ingredientUnits.filter(unit => unit.ingredient_id === item.id),
            ].filter((unit, index, all) =>
              all.findIndex(candidate => candidate.unit_name.trim().toLowerCase() === unit.unit_name.trim().toLowerCase()) === index
            )
            const factor = getStocktakeFactor(item, row.input_unit)
            return <tr key={item.id}><td><strong>{item.name}</strong><small>Stok dasar: {item.base_unit}</small></td>
              <td><select value={row.input_unit} onChange={e => setDraft(prev => ({...prev,[item.id]:{...row,input_unit:e.target.value}}))}>
                {availableUnits.map(unit => <option key={unit.unit_name} value={unit.unit_name}>{unit.unit_name}</option>)}
              </select></td>
              <td><input aria-label={`Jumlah fisik ${item.name}`} type="number" min="0" step="0.0001" value={row.input_quantity} onChange={e => setDraft(prev => ({...prev,[item.id]:{...row,input_quantity:e.target.value}}))} placeholder="Belum dihitung"/></td>
              <td>{row.input_quantity === '' ? '—' : `${quantity(Number(row.input_quantity)*factor)} ${item.base_unit}`}{row.input_unit.toLowerCase() !== item.base_unit.toLowerCase() && factor > 0 && <small>1 {row.input_unit} = {quantity(factor)} {item.base_unit}</small>}</td>
            </tr>
          })}{!ingredients.length && <tr><td colSpan={4}>Belum ada bahan aktif.</td></tr>}</tbody>
        </table>
      </div>
      <div className="form-actions"><button className="primary-button" type="submit" disabled={saving || loading || !unitId || !ingredients.length}>{saving ? <LoaderCircle size={16} className="spin"/> : <ClipboardCheck size={16}/>} {saving ? 'Mengajukan…' : 'Ajukan untuk persetujuan Owner'}</button></div>
    </form>}

    {detail && <section className="user-form">
      <div className="user-form-heading"><div><h2>Rincian opname</h2><p className="muted">{unitName(detail.unit_id)} · {new Date(detail.submitted_at).toLocaleString('id-ID')} · {statusText[detail.status]}</p></div>
        <button type="button" className="secondary-button" onClick={() => setDetail(null)}>Kembali</button></div>
      <div className="users-table-wrap"><table className="users-table"><thead><tr><th>Bahan</th><th>Saldo sistem</th><th>Hitung fisik</th><th>Selisih</th><th>Nilai selisih perkiraan</th></tr></thead>
        <tbody>{detailItems.map(item => { const delta=Number(item.variance_quantity); return <tr key={item.id}>
          <td><strong>{ingredientName(item.ingredient_id)}</strong><small>Input: {quantity(Number(item.input_quantity))} {item.input_unit}</small></td>
          <td>{quantity(Number(item.system_quantity))} {item.base_unit}</td><td>{quantity(Number(item.counted_base_quantity))} {item.base_unit}</td>
          <td><strong>{delta>0?'+':''}{quantity(delta)} {item.base_unit}</strong><small>{delta<0?'Kurang dari saldo sistem':delta>0?'Lebih dari saldo sistem':'Sesuai'}</small></td>
          <td>{'—'}<small>Nilai rupiah belum dihitung pada tampilan ini</small></td>
        </tr>})}</tbody></table></div>
      {detail.status === 'pending' && isOwner && <form onSubmit={e=>{e.preventDefault();void review(true)}} className="user-form">
        <label className="field"><span>Catatan pemeriksaan Owner (wajib)</span><textarea required minLength={3} value={reviewNote} onChange={e=>setReviewNote(e.target.value)} placeholder="Contoh: hasil hitung fisik sudah diverifikasi oleh penanggung jawab unit."/></label>
        <div className="form-actions"><button type="submit" className="primary-button" disabled={saving}>{saving?<LoaderCircle size={16} className="spin"/>:<CheckCircle2 size={16}/>} Setujui & terapkan koreksi</button>
          <button type="button" className="secondary-button" disabled={saving} onClick={()=>void review(false)}><X size={16}/> Tolak pengajuan</button></div>
        <p className="users-footnote">Jika saldo berubah setelah pengajuan dibuat, database akan menolak persetujuan. Petugas harus melakukan opname ulang.</p>
      </form>}
      {detail.review_note && <div className="notice"><ShieldCheck size={17}/><span>Catatan Owner: {detail.review_note}</span></div>}
    </section>}

    <section className="users-table-wrap">
      <div className="sales-panel-heading" style={{padding:'18px 20px'}}><div><h2>Riwayat pengajuan opname</h2><p className="muted">Pengajuan terbaru yang dapat diakses akun ini.</p></div></div>
      {loading ? <div className="users-empty"><LoaderCircle size={20} className="spin"/> Memuat pengajuan…</div> :
      <table className="users-table"><thead><tr><th>Waktu</th><th>Unit</th><th>Status</th><th>Catatan</th><th>Aksi</th></tr></thead><tbody>
        {headers.filter(h=>isOwner || h.unit_id===profile?.unit_id).map(h=><tr key={h.id}><td>{new Date(h.submitted_at).toLocaleString('id-ID')}</td><td>{unitName(h.unit_id)}</td>
          <td><span className={`status-tag ${h.status==='approved'?'active':h.status==='pending'?'inactive':'inactive'}`}>{statusText[h.status]}</span></td><td>{h.notes||'—'}</td>
          <td><button type="button" className="small-action" onClick={()=>void openDetail(h)}><ClipboardList size={14}/> Detail</button></td></tr>)}
        {!headers.filter(h=>isOwner || h.unit_id===profile?.unit_id).length && <tr><td colSpan={5}>Belum ada pengajuan opname.</td></tr>}
      </tbody></table>}
    </section>
    <p className="users-footnote"><ShieldCheck size={15}/> Saldo hanya berubah setelah persetujuan Owner. Semua koreksi harus dapat ditelusuri di riwayat stok.</p>
  </div>
}

function StockReportsModule() {
  const [units, setUnits] = useState<BusinessUnit[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [balances, setBalances] = useState<StockBalance[]>([])
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [selectedUnit, setSelectedUnit] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState('')

  async function loadReport() {
    if (!supabase) return
    setLoading(true)
    setError('')
    const [unitRes, ingredientRes, balanceRes, movementRes] = await Promise.all([
      supabase.from('business_units').select('id,code,name,kind,is_active').eq('is_active', true).order('name'),
      supabase.from('ingredients').select('id,code,name,base_unit,alternate_unit,alternate_factor,reorder_level,is_active').order('name'),
      supabase.from('inventory_balances').select('unit_id,ingredient_id,quantity,average_unit_cost'),
      supabase.from('inventory_movements').select('id,unit_id,ingredient_id,kind,quantity_delta,unit_cost,note,created_at,input_quantity,input_unit,conversion_factor,base_quantity').order('created_at', { ascending: false }).limit(200),
    ])
    const errors = [unitRes.error, ingredientRes.error, balanceRes.error, movementRes.error].filter(Boolean)
    if (errors.length) setError(`Laporan belum lengkap: ${errors.map(e => e!.message).join(' · ')}`)
    if (!unitRes.error) setUnits((unitRes.data || []) as BusinessUnit[])
    if (!ingredientRes.error) setIngredients((ingredientRes.data || []) as Ingredient[])
    if (!balanceRes.error) setBalances((balanceRes.data || []) as StockBalance[])
    if (!movementRes.error) setMovements((movementRes.data || []) as StockMovement[])
    setUpdatedAt(new Date().toLocaleString('id-ID'))
    setLoading(false)
  }

  useEffect(() => { void loadReport() }, [])

  const ingredientById = new Map(ingredients.map(i => [i.id, i]))
  const unitById = new Map(units.map(u => [u.id, u]))
  const visibleBalances = balances.filter(b => selectedUnit === 'all' || b.unit_id === selectedUnit)
  const rows = visibleBalances.map(b => {
    const ingredient = ingredientById.get(b.ingredient_id)
    const unit = unitById.get(b.unit_id)
    return { ...b, ingredient, unit, value: Number(b.quantity || 0) * Number(b.average_unit_cost || 0) }
  }).filter(r => r.ingredient && r.unit)
  const totalQtyRows = rows.length
  const totalValue = rows.reduce((sum, r) => sum + r.value, 0)
  const lowStock = rows.filter(r => r.ingredient && Number(r.quantity) <= Number(r.ingredient.reorder_level))
  const unitTotals = units.map(unit => ({
    ...unit,
    count: rows.filter(r => r.unit_id === unit.id).length,
    value: rows.filter(r => r.unit_id === unit.id).reduce((sum, r) => sum + r.value, 0),
  }))
  const recentMovements = movements.filter(m => selectedUnit === 'all' || m.unit_id === selectedUnit).slice(0, 30)

  return <div className="stock-page">
    <div className="page-heading">
      <div><p className="eyebrow">RINGKASAN PERSEDIAAN</p><h1>Laporan Stok & Nilai Persediaan</h1><p className="muted">Nilai stok dihitung dari saldo saat ini × harga pokok rata-rata yang tersimpan di database.</p></div>
      <button className="secondary-button" onClick={() => void loadReport()} disabled={loading}><RefreshCw size={16} /> Muat ulang</button>
    </div>
    {error && <div className="form-message users-alert">{error}</div>}
    <div className="user-form-grid">
      <label className="field"><span>Filter unit</span><select value={selectedUnit} onChange={e => setSelectedUnit(e.target.value)}><option value="all">Semua unit</option>{units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
    </div>
    <div className="summary-grid">
      <article className="summary-card"><span>Nilai persediaan</span><strong>{loading ? 'Memuat…' : money(totalValue)}</strong><small>{selectedUnit === 'all' ? 'Gabungan unit yang dapat diakses' : unitById.get(selectedUnit)?.name}</small></article>
      <article className="summary-card"><span>Baris saldo stok</span><strong>{loading ? '—' : String(totalQtyRows)}</strong><small>Bahan per unit dengan saldo tercatat</small></article>
      <article className="summary-card"><span>Perlu diperiksa</span><strong>{loading ? '—' : String(lowStock.length)}</strong><small>Saldo sama dengan atau di bawah batas minimum</small></article>
    </div>
    {selectedUnit === 'all' && <section className="panel"><div className="section-heading"><div><h2>Nilai persediaan per unit</h2><p className="muted">Perbandingan nilai stok antar cabang dan bazar.</p></div></div><div className="table-wrap"><table><thead><tr><th>Unit</th><th>Jenis</th><th>Baris stok</th><th>Nilai persediaan</th></tr></thead><tbody>{unitTotals.map(u => <tr key={u.id}><td><strong>{u.name}</strong></td><td>{u.kind === 'branch' ? 'Cabang' : 'Bazar'}</td><td>{u.count}</td><td><strong>{money(u.value)}</strong></td></tr>)}</tbody></table></div></section>}
    <section className="panel"><div className="section-heading"><div><h2>Rincian saldo dan valuasi</h2><p className="muted">Harga pokok rata-rata berasal dari saldo database, bukan harga jual menu.</p></div></div><div className="table-wrap"><table><thead><tr><th>Unit</th><th>Bahan</th><th>Saldo</th><th>Rata-rata biaya</th><th>Nilai stok</th><th>Status</th></tr></thead><tbody>{rows.map((r, index) => <tr key={`${r.unit_id}-${r.ingredient_id}-${index}`}><td>{r.unit?.name}</td><td><strong>{r.ingredient?.name}</strong></td><td>{quantity(Number(r.quantity))} {r.ingredient?.base_unit}</td><td>{money(Number(r.average_unit_cost || 0))}/{r.ingredient?.base_unit}</td><td><strong>{money(r.value)}</strong></td><td>{Number(r.quantity) <= Number(r.ingredient?.reorder_level || 0) ? <span className="phase-pill">Minimum</span> : <span className="phase-pill">Aman</span>}</td></tr>)}{!loading && rows.length === 0 && <tr><td colSpan={6}>Belum ada saldo stok untuk filter ini.</td></tr>}</tbody></table></div></section>
    <section className="panel"><div className="section-heading"><div><h2>Riwayat stok terbaru</h2><p className="muted">Maksimal 30 pergerakan terbaru sesuai filter unit.</p></div></div><div className="table-wrap"><table><thead><tr><th>Waktu</th><th>Unit</th><th>Bahan</th><th>Jenis</th><th>Jumlah input</th><th>Perubahan saldo dasar</th><th>Catatan</th></tr></thead><tbody>{recentMovements.map(m => { const ing = ingredientById.get(m.ingredient_id); const delta = Number(m.quantity_delta || 0); return <tr key={m.id}><td>{new Date(m.created_at).toLocaleString('id-ID')}</td><td>{unitById.get(m.unit_id)?.name || '—'}</td><td>{ing?.name || '—'}</td><td>{m.kind}</td><td>{m.input_quantity != null ? `${quantity(Number(m.input_quantity))} ${m.input_unit || ''}` : '—'}</td><td>{delta > 0 ? '+' : ''}{quantity(delta)} {ing?.base_unit || ''}</td><td>{m.note || '—'}</td></tr>})}{!loading && recentMovements.length === 0 && <tr><td colSpan={7}>Belum ada riwayat stok.</td></tr>}</tbody></table></div></section>
    <p className="muted">Data diperbarui: {updatedAt || '—'}. Laporan ini membaca data yang tersedia sesuai hak akses Supabase.</p>
  </div>
}

function ModulePlaceholder({ title, role }: { title: string; role?: Role }) {
  return <div className="placeholder-card"><div className="module-icon"><ClipboardList size={23} /></div><p className="eyebrow">MODUL TERENCANA</p><h1>{title}</h1><p className="muted">Modul ini belum diaktifkan pada baseline pertama. Struktur akses dan database akan disiapkan sebelum transaksi nyata diaktifkan.</p><div className="warning-box"><ShieldCheck size={18} /><p>Peran saat ini: <strong>{role ? roleLabels[role] : 'belum ditetapkan'}</strong>. Jangan mencatat transaksi produksi di modul yang belum selesai.</p></div><button className="secondary-button" onClick={() => window.location.reload()}>Muat ulang aplikasi</button></div>
}
