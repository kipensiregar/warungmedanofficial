# Warung Medan CT Catering — Unified App

Baseline repository baru untuk mengintegrasikan kasir, dapur, stok/resep, keuangan, dan laporan dalam satu aplikasi. Repository ini terpisah dari repo `keuangan` yang lama.

> **Status: fondasi awal, belum siap untuk transaksi produksi.** UI login/dashboard dan skema database awal disiapkan. Modul transaksi, resep otomatis, kas, migrasi data lama, dan uji keamanan end-to-end masih harus dibangun sebelum operasional nyata.

## Stack
- React + TypeScript + Vite
- Supabase Auth + PostgreSQL + Row Level Security
- GitHub Actions + GitHub Pages

## 1. Buat repository baru

Buat repo kosong bernama misalnya `warung-medan-unified`. Upload isi folder ini ke root repository. Jangan mengunggah isi ini ke repository `keuangan` yang lama.

## 2. Jalankan lokal

```bash
npm install
cp .env.example .env
```

Isi `.env` dengan URL dan publishable/anon key dari proyek Supabase baru, kemudian:

```bash
npm run dev
```

Untuk memeriksa TypeScript/build:

```bash
npm run build
```

## 3. Siapkan Supabase

1. Buat proyek Supabase baru untuk pengujian.
2. Buka SQL Editor.
3. Review lalu jalankan `supabase/migrations/202610130001_initial_schema.sql`.
4. Buat akun melalui Supabase Authentication.
5. Provision profil pengguna melalui SQL Editor/dashboard sebagai admin proyek. Jangan memberi pengguna hak membuat atau mengubah peran sendiri.

Contoh membuat profil owner (ganti UUID dengan User UID dari Authentication):

```sql
insert into public.user_profiles(user_id, display_name, role, unit_id, is_active)
values ('GANTI-DENGAN-USER-UUID', 'Owner', 'owner', null, true);
```

Contoh profil kasir (gunakan ID unit yang benar dari tabel `business_units`):

```sql
insert into public.user_profiles(user_id, display_name, role, unit_id, is_active)
select 'GANTI-DENGAN-USER-UUID', 'Kasir Cabang 1', 'cashier', id, true
from public.business_units where code = 'branch-1';
```

**Catatan:** skema awal memakai empat unit contoh (`branch-1`, `branch-2`, `bazaar-1`, `bazaar-2`). Ubah nama/kode sebelum data operasional dimasukkan jika struktur unit yang sebenarnya berbeda.

## 4. Environment GitHub Pages

Di repo baru buka **Settings → Secrets and variables → Actions → Variables**, lalu tambahkan:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Aktifkan **Settings → Pages → Build and deployment → Source: GitHub Actions**. Workflow `.github/workflows/deploy.yml` membangun aplikasi dengan base path sesuai nama repository.

Hanya URL proyek dan publishable/anon key yang boleh digunakan di browser. **Jangan pernah menaruh Supabase service-role key di `.env` frontend, GitHub Variables, atau kode React.**

## 5. Apa yang belum aktif

- Modul kasir yang membuat transaksi nyata.
- RPC transaksi atomik untuk pembayaran + pemakaian resep + stok + pembatalan.
- Penerimaan pembelian bahan, transfer antarunit, dan stok opname.
- Buku kas/bank, metode pembayaran, jurnal, HPP dan laporan historis.
- Alur antrean dapur realtime dan pencetakan printer.
- Migrasi data dari IndexedDB/Firebase lama.
- Offline queue, idempotensi transaksi, dan uji beban/keamanan.

RLS awal sengaja tidak mengizinkan client melakukan insert/update/delete penjualan atau mengubah saldo stok secara langsung. Ini menjaga supaya transaksi nyata tidak bisa dibuat sebelum RPC tervalidasi selesai.

## Prinsip keamanan
- Owner perlu membuat profil pengguna dan menetapkan unit.
- Peran dan unit ditegakkan melalui RLS di database, bukan hanya menyembunyikan tombol.
- Semua transaksi produksi nantinya harus lewat RPC yang memvalidasi role, unit, stok, dan `client_request_id` agar aman dari pengiriman ganda.
- Gunakan proyek Supabase uji dan data dummy dulu. Free tier bukan pengganti backup operasional.
