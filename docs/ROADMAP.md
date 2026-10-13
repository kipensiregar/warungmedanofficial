# Roadmap integrasi

## Tahap 1 — Fondasi (repo ini)
- [x] Baseline React + TypeScript + Vite
- [x] Login Supabase Auth
- [x] Pembacaan profil role/unit
- [x] SQL awal unit, pengguna, menu, resep, stok, penjualan, pengeluaran, audit
- [x] RLS awal dan deploy GitHub Pages
- [ ] Build dan tes end-to-end dengan proyek Supabase uji

## Tahap 2 — Operasional master data
- [ ] Halaman unit dan pengelolaan profil owner-only
- [ ] CRUD bahan baku, menu, resep, satuan dan harga
- [ ] Pembukaan saldo stok dan migrasi data yang tervalidasi

## Tahap 3 — Transaksi yang aman
- [ ] RPC `post_sale` atomik: validasi role/unit, hitung harga di server, cek stok, simpan penjualan/item, mutasi resep, update saldo
- [ ] Idempotensi `client_request_id` dan penguncian stok untuk transaksi bersamaan
- [ ] RPC pembatalan/void yang membuat reversal, bukan menghapus transaksi
- [ ] Penerimaan stok dan biaya pembelian dengan average-cost yang terdokumentasi

## Tahap 4 — Dapur dan printer
- [ ] Kitchen display realtime per unit
- [ ] Status pesanan dan riwayat perubahan
- [ ] Adapter printer, pengujian perangkat dan strategi antrean persisten

## Tahap 5 — Keuangan dan laporan
- [ ] Buku kas/bank, pengeluaran dan transfer internal
- [ ] HPP berdasarkan biaya stok yang berlaku saat transaksi
- [ ] Laporan harian/bulanan dan laporan konsolidasi owner
- [ ] Laporan historis tidak dihitung dari saldo stok terkini

## Tahap 6 — Offline, keamanan, rilis
- [ ] Offline queue dengan idempotensi dan rekonsiliasi konflik
- [ ] Uji RLS untuk setiap role/unit
- [ ] Uji concurrent sale, void, stok negatif, backup/restore
- [ ] Migrasi bertahap dan rencana rollback
