import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Activity, ArrowDownToLine, ArrowUpRight, BarChart3, ChefHat, CircleDollarSign, ClipboardList, Cloud, Database, LayoutDashboard, LogIn, LogOut, Package, ShieldCheck, ShoppingBasket, Store, Users } from 'lucide-react'
import { isSupabaseConfigured, supabase } from './lib/supabase'

type Profile = { display_name: string | null; role: 'owner' | 'cashier' | 'tenant' | 'kitchen'; unit_id: string | null; is_active: boolean }

const roleLabels: Record<Profile['role'], string> = { owner: 'Owner', cashier: 'Kasir', tenant: 'Tim Tenant', kitchen: 'Tim Dapur' }
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
    if (!supabase) return
    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
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
    supabase.from('user_profiles').select('display_name, role, unit_id, is_active').eq('user_id', session.user.id).maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return
        if (error) setMessage(`Profil belum dapat dibaca: ${error.message}`)
        else if (data) {
          const next = data as Profile
          setProfile(next)
          if (!next.is_active) setMessage('Akun ini dinonaktifkan. Hubungi owner.')
        } else setMessage('Akun berhasil login, tetapi profil belum dibuat. Owner perlu menugaskan peran dan unit di database.')
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
  const title = active
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Store size={22} /></div><div><strong>Warung Medan</strong><span>CT Catering · Terpadu</span></div></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav>{visibleItems.map(item => <button key={item.label} className={`nav-item ${active === item.label ? 'active' : ''}`} onClick={() => setActive(item.label)}><item.icon size={18} /><span>{item.label}</span></button>)}</nav>
      <div className="sidebar-bottom"><div className="secure-note"><ShieldCheck size={17} /><span>Akses mengikuti peran akun</span></div><button className="nav-item logout" onClick={handleLogout}><LogOut size={18} /><span>Keluar</span></button></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="breadcrumb">Warung Medan <span>/</span> <strong>{title}</strong></div><div className="user-chip"><div className="avatar">{(profile?.display_name || session.user.email || 'U').slice(0,1).toUpperCase()}</div><div><strong>{profile?.display_name || session.user.email}</strong><span>{profile?.role ? roleLabels[profile.role] : 'Profil belum lengkap'}</span></div></div></header>
      <section className="content">
        {message && <div className="notice"><Activity size={17} />{message}</div>}
        {active === 'Dashboard' ? <Dashboard profile={profile} email={session.user.email || ''} /> : <ModulePlaceholder title={active} role={role} />}
        {!profile && <div className="notice warning"><ShieldCheck size={18} /><div><strong>Profil akses belum siap.</strong><p>Jangan gunakan akun ini untuk operasional sampai owner membuat profil dan menetapkan unit yang benar.</p></div></div>}
      </section>
    </main>
  </div>
}

function SetupScreen() {
  return <div className="center-screen"><div className="setup-card"><div className="brand-mark large"><Cloud size={28} /></div><p className="eyebrow">LANGKAH PERTAMA</p><h1>Hubungkan database cloud</h1><p className="muted">Aplikasi berhasil dimuat, tetapi konfigurasi Supabase belum diisi. Salin <code>.env.example</code> menjadi <code>.env</code> lalu isi URL dan publishable key dari proyek Supabase milikmu.</p><div className="setup-steps"><div><span>1</span><p>Buat proyek Supabase baru.</p></div><div><span>2</span><p>Jalankan SQL migration di folder <code>supabase/migrations</code>.</p></div><div><span>3</span><p>Isi variabel environment di lokal dan GitHub Actions Secrets/Variables.</p></div></div><div className="warning-box"><ShieldCheck size={18} /><p>Jangan masukkan service-role key ke aplikasi browser atau ke repository.</p></div></div></div>
}

function LoginScreen({ email, setEmail, password, setPassword, onSubmit, message }: { email: string; setEmail: (v: string) => void; password: string; setPassword: (v: string) => void; onSubmit: (e: FormEvent<HTMLFormElement>) => void; message: string }) {
  return <div className="login-layout"><div className="login-story"><div className="brand light"><div className="brand-mark"><Store size={22} /></div><div><strong>Warung Medan</strong><span>CT Catering · Sistem Terpadu</span></div></div><div className="story-copy"><p className="eyebrow">SATU OPERASIONAL · SATU DATA</p><h1>Dari dapur sampai laporan, semua terhubung.</h1><p>Kasir, pesanan dapur, stok bahan baku, dan keuangan dirancang untuk bekerja dalam satu alur yang dapat diaudit.</p><div className="story-points"><span><Package size={17} /> Stok berbasis resep</span><span><ArrowUpRight size={17} /> Laporan per unit</span><span><ShieldCheck size={17} /> Akses sesuai peran</span></div></div><div className="story-footer">Dibangun untuk operasional Warung Medan CT Catering.</div></div><div className="login-panel"><form className="login-card" onSubmit={onSubmit}><div className="login-icon"><LogIn size={23} /></div><p className="eyebrow">SELAMAT DATANG KEMBALI</p><h2>Masuk ke aplikasi</h2><p className="muted">Gunakan akun yang telah dibuat oleh owner.</p><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} placeholder="nama@perusahaan.com" /><label htmlFor="password">Kata sandi</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Masukkan kata sandi" />{message && <div className="form-message">{message}</div>}<button className="primary-button" type="submit">Masuk <ArrowUpRight size={17} /></button><p className="login-footnote"><ShieldCheck size={15} /> Login dilayani oleh Supabase Auth.</p></form></div></div>
}

function Dashboard({ profile, email }: { profile: Profile | null; email: string }) {
  const name = profile?.display_name || email.split('@')[0] || 'Pengguna'
  const role = profile?.role
  return <><div className="page-heading"><div><p className="eyebrow">RINGKASAN OPERASIONAL</p><h1>Halo, {name} 👋</h1><p className="muted">Selamat datang di workspace Warung Medan CT Catering.</p></div><div className="connection-pill"><span className="status-dot" /> Terhubung ke akun</div></div><div className="welcome-banner"><div><span className="banner-tag">WORKSPACE AKTIF</span><h2>{role ? roleLabels[role] : 'Akses sedang disiapkan'}</h2><p>{profile?.unit_id ? `Unit penugasan: ${profile.unit_id}` : role === 'owner' ? 'Anda memiliki akses lintas unit.' : 'Unit penugasan belum ditentukan oleh owner.'}</p></div><div className="banner-icon"><Store size={38} /></div></div><div className="section-heading"><div><h2>Modul aplikasi</h2><p>Fondasi navigasi untuk pengembangan berikutnya.</p></div><span className="phase-pill">FASE 1 · FONDASI</span></div><div className="module-grid">{[
    { title: 'Kasir & Penjualan', description: 'Transaksi, pembayaran, dan struk.', icon: ShoppingBasket, status: 'Dalam pengembangan' },
    { title: 'Dapur & Pesanan', description: 'Antrean pesanan dan status masak.', icon: ChefHat, status: 'Dalam pengembangan' },
    { title: 'Stok & Resep', description: 'Bahan baku, mutasi, dan resep menu.', icon: Package, status: 'Dalam pengembangan' },
    { title: 'Keuangan', description: 'Kas, beban, HPP, dan laba rugi.', icon: CircleDollarSign, status: role === 'owner' ? 'Khusus owner' : 'Akses dibatasi' },
    { title: 'Laporan', description: 'Per unit dan konsolidasi usaha.', icon: BarChart3, status: role === 'owner' ? 'Khusus owner' : 'Akses dibatasi' },
    { title: 'Penerimaan stok', description: 'Catat bahan masuk per unit.', icon: ArrowDownToLine, status: 'Dalam pengembangan' },
  ].filter(m => role === 'owner' || !['Keuangan', 'Laporan'].includes(m.title)).map((m) => <article className="module-card" key={m.title}><div className="module-icon"><m.icon size={20} /></div><h3>{m.title}</h3><p>{m.description}</p><span className="module-status">{m.status}</span></article>)}</div><div className="next-step"><div className="next-icon"><Database size={20} /></div><div><strong>Fondasi database sudah disiapkan dalam repository.</strong><p>Langkah berikutnya: jalankan migration Supabase, buat unit usaha, lalu buat profil dan peran pengguna.</p></div><ClipboardList className="next-arrow" size={20} /></div></>
}

function ModulePlaceholder({ title, role }: { title: string; role?: Profile['role'] }) {
  return <div className="placeholder-card"><div className="module-icon"><ClipboardList size={23} /></div><p className="eyebrow">MODUL TERENCANA</p><h1>{title}</h1><p className="muted">Modul ini belum diaktifkan pada baseline pertama. Struktur akses dan database akan disiapkan sebelum transaksi nyata diaktifkan.</p><div className="warning-box"><ShieldCheck size={18} /><p>Peran saat ini: <strong>{role ? roleLabels[role] : 'belum ditetapkan'}</strong>. Jangan mencatat transaksi produksi di modul yang belum selesai.</p></div><button className="secondary-button" onClick={() => window.location.reload()}>Muat ulang aplikasi</button></div>
}
