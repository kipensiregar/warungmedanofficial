import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  Activity, ArrowDownToLine, ArrowUpRight, BarChart3, ChefHat,
  CircleDollarSign, ClipboardList, Cloud, Database, LayoutDashboard,
  LogIn, LogOut, Package, ShieldCheck, ShoppingBasket, Store, Users,
  Pencil, UserPlus, RefreshCw, Ban, CheckCircle2, X, LoaderCircle,
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

const roleLabels: Record<Role, string> = {
  owner: 'Owner', cashier: 'Kasir Cabang', tenant: 'Tim Tenant', kitchen: 'Tim Dapur',
}
const navItems = [
  { label: 'Dashboard', icon: LayoutDashboard, roles: ['owner', 'cashier', 'tenant', 'kitchen'] },
  { label: 'Kasir & Penjualan', icon: ShoppingBasket, roles: ['owner', 'cashier', 'tenant'] },
  { label: 'Antrean Dapur', icon: ChefHat, roles: ['owner', 'kitchen', 'tenant'] },
  { label: 'Stok & Resep', icon: Package, roles: ['owner', 'cashier', 'kitchen'] },
  { label: 'Keuangan', icon: CircleDollarSign, roles: ['owner'] },
  { label: 'Laporan', icon: BarChart3, roles: ['owner'] },
  { label: 'Pengguna & Unit', icon: Users, roles: ['owner'] },
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
    if (userResult.error) setError(`Gagal memuat pengguna: ${userResult.error.message}`)
    else if (userResult.data?.error) setError(`Gagal memuat pengguna: ${userResult.data.error}`)
    else setUsers((userResult.data?.users || []) as ManagedUser[])
    if (unitResult.error) setError(prev => [prev, `Gagal memuat unit: ${unitResult.error.message}`].filter(Boolean).join(' · '))
    else setUnits((unitResult.data || []) as BusinessUnit[])
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
            <td><div className="row-actions"><button className="small-action" onClick={() => startEdit(user)}><Pencil size={14} /> Edit</button><button className="small-action" onClick={() => void toggleActive(user)} disabled={user.user_id === currentUserId && user.is_active}>{user.is_active ? <><Ban size={14} /> Nonaktifkan</> : <><CheckCircle2 size={14} /> Aktifkan</>}</button></div></td>
          </tr>
        })}</tbody>
      </table>}
    </div>
    <p className="users-footnote"><ShieldCheck size={15} /> Penghapusan permanen tidak disediakan agar jejak transaksi tetap terjaga. Jangan menonaktifkan satu-satunya akun Owner.</p>
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
