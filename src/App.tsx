import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  Activity, ArrowDownToLine, ArrowUpRight, BarChart3, ChefHat,
  CircleDollarSign, ClipboardList, Cloud, Database, LayoutDashboard,
  LogIn, LogOut, Package, ShieldCheck, ShoppingBasket, Store, Users,
  Pencil, UserPlus, RefreshCw, Ban, CheckCircle2, X, LoaderCircle,
  Plus, Minus, Trash2, Receipt, ShoppingCart, Utensils,
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
  { label: 'Stok Bahan Baku', icon: Package, roles: ['owner', 'cashier', 'kitchen'] },
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
