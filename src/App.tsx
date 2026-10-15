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
