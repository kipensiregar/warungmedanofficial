# Audit Integrasi — Warung Medan CT Catering

Tanggal audit: 13 Oktober 2026  
Tujuan: menggabungkan `keuangan-main`, `kasir-bazar`, dan `blueprintFIX` menjadi satu aplikasi tanpa mengubah repository `keuangan` yang sekarang.

## Keputusan utama

- Buat repository baru, misalnya `warung-medan-ct-unified`.
- Pertahankan `keuangan-main` sebagai fondasi modul keuangan, inventaris, multi-unit, dan audit.
- Adaptasi komponen POS/printer dari `kasir-bazar`.
- Jadikan `blueprintFIX` referensi alur dapur/antrean; jangan menjadikan HTML mandiri itu sebagai arsitektur utama.
- Rancang satu sumber data cloud operasional (kandidat PostgreSQL/Supabase), dengan otorisasi yang dipaksakan di server/database. Jangan menjalankan Firebase dan Supabase sebagai dua sumber kebenaran yang bersaing.
- Integrasi harus bertahap; setiap tahap diuji sebelum berlanjut. Jangan melakukan migrasi data produksi tanpa backup dan uji pemulihan.

## 1. Isi paket yang diaudit

### `keuangan-main`

- React + TypeScript + Vite + Dexie/IndexedDB.
- Modul dashboard, transaksi, inventaris, menu, laporan, pengaturan, utang/piutang, akun, transfer antarunit, event bazar, audit log, dan backup terenkripsi.
- Database lokal memakai versi Dexie 1–3 dan memiliki migrasi untuk unit/event serta stok satuan utama/tambahan.
- Seed data otomatis menambahkan unit, event, akun, bahan baku, dan menu contoh saat tabel kosong. Seed ini perlu ditinjau sebelum produksi agar tidak tercampur dengan data nyata.
- `syncOutbox` ada di skema, tetapi sinkronisasi cloud dinyatakan belum aktif; `getPendingSyncCount()` mengembalikan 0.
- `ProductMenu` hanya menyimpan `estimatedHpp`; belum ada resep/BOM yang menghubungkan menu ke bahan baku.
- Penjualan utama dicatat sebagai ringkasan harian dengan pemecahan pembayaran, bukan transaksi POS terperinci per item.
- Tes akuntansi bawaan dilaporkan 26/26 lulus dalam status paket, tetapi build penuh, browser/IndexedDB E2E, dan deploy belum terverifikasi di lingkungan audit.

### `kasir-bazar`

- React + TypeScript + Vite, Firebase/Firestore, komponen katalog, keranjang, checkout, riwayat, struk, pengaturan, printer Bluetooth, dan printer station.
- Ada `server.ts` Express untuk antrean order melalui SSE/polling. Antrean disimpan dalam `Map` di memori proses, sehingga bukan antrean persisten dan dapat hilang ketika server restart.
- Proyek mengandalkan server Node untuk sejumlah fungsi; karena GitHub Pages hanya hosting statis, bagian server tidak bisa langsung di-deploy di Pages. Fungsi itu perlu dipindah ke backend persisten atau diganti dengan layanan cloud.
- Berkas `firestore.rules` di paket tampak kosong/tidak berisi aturan yang dapat diaudit. Aturan akses Firestore produksi harus ditetapkan dan diuji sebelum digunakan.
- Spesifikasi keamanan (`security_spec.md`) mendeskripsikan invariant transaksi, tetapi spesifikasi tidak membuktikan bahwa aturan tersebut benar-benar ditegakkan di server.
- `firebase-applet-config.json` berisi konfigurasi proyek Firebase. Konfigurasi klien bukan pengganti aturan keamanan; audit ini tidak menganggap database aman hanya karena ada konfigurasi.

### `blueprintFIX`

- Satu berkas HTML sekitar 44 KB, memuat Firebase Realtime Database SDK versi 8, Tailwind CDN, dan pustaka ekspor Excel/PDF.
- Menggambarkan alur kasir, PIN, pesanan dapur, stok menu, pengeluaran, laporan, dan struk.
- Tidak memiliki pemisahan komponen/tipe/domain seperti proyek React. Logika harus dipetakan ulang, bukan ditempel utuh ke aplikasi utama.
- Menggunakan URL Firebase Realtime Database langsung. Aturan keamanan database tidak disertakan, jadi izin baca/tulis belum dapat dinilai.
- PIN/fallback di UI tidak boleh dianggap sebagai autentikasi. Akun dan izin produksi perlu dibangun ulang di backend.

## 2. Arsitektur target

1. **Frontend:** React + TypeScript + Vite; gunakan UI `keuangan-main` sebagai fondasi.
2. **Database utama:** PostgreSQL/Supabase sebagai kandidat; satu sumber kebenaran untuk pengguna, unit, event, penjualan, item penjualan, pembayaran, resep, stok, mutasi, biaya, akun, dan audit.
3. **Autentikasi/otorisasi:** akun per orang/per perangkat sesuai kebutuhan; role dan unit assignment disimpan di database; RLS dan/atau backend tepercaya membatasi akses. Jangan hanya menyembunyikan tab di frontend.
4. **POS/KDS:** penjualan per item, nomor pesanan, status dapur, metode pembayaran, struk, dan riwayat. Perubahan status dapur tidak boleh membuat transaksi/stock movement duplikat.
5. **Resep/BOM:** setiap menu memiliki daftar bahan, jumlah per porsi, satuan, dan versi resep. Saat penjualan final, stok bahan dipotong secara atomik sesuai resep dan event/unit.
6. **Ledger stok:** setiap perubahan stok mempunyai mutasi yang dapat diaudit; pembatalan memakai reversal/void, bukan hapus transaksi final.
7. **Akuntansi:** transaksi POS menjadi sumber penjualan; pembayaran menjadi penerimaan kas/bank/QRIS; HPP berasal dari konsumsi bahan/valuasi stok; transfer internal tidak dihitung sebagai pendapatan/beban konsolidasi.
8. **Offline:** tentukan eksplisit apakah offline mode hanya baca/cache atau boleh antre transaksi. Jika boleh antre, gunakan ID idempotensi, konflik yang terdeteksi, dan sinkronisasi yang aman.
9. **Deploy:** repository baru + GitHub Actions; frontend statis dapat di-host di GitHub Pages, tetapi backend/database tetap berada di layanan cloud. `server.ts` tidak bisa berjalan hanya dari GitHub Pages.

## 3. Peran awal

- Owner: seluruh unit, semua laporan, pengaturan, pengguna, dan master data.
- Kasir Cabang 1: transaksi/penjualan dan penerimaan stok unitnya.
- Kasir Cabang 2: transaksi/penjualan dan penerimaan stok unitnya.
- Tim Tenant Bazar 1/2: penjualan dan pesanan hanya untuk event/unit yang ditugaskan.
- Tim Dapur Bazar 1/2: antrean dapur dan penerimaan/pemakaian stok sesuai penugasan.

Model data saat ini hanya memiliki satu unit `Bazar` dengan event-event di dalamnya. Jangan membuat `Bazar 1` dan `Bazar 2` sebagai store ID baru sampai diputuskan apakah keduanya adalah dua event di unit yang sama atau dua unit operasional berbeda. Pertahankan ID lama dan mapping migrasi agar data tidak terputus.

## 4. Prioritas implementasi

### Tahap 1 — Fondasi repo baru
- Salin `keuangan-main` ke repository baru sebagai baseline.
- Pastikan nama, identitas aplikasi, workflow, base path, dan environment deployment cocok dengan repo baru.
- Tambahkan tes/build gate; tidak ada perubahan ke repository lama.

### Tahap 2 — Domain dan database cloud
- Buat skema, constraints, indeks, RLS, migrasi, dan seed khusus development.
- Tentukan mapping `store_sungai_baung`, `store_palembang_center`, `store_bazar` serta `eventId`.
- Buat migrasi IndexedDB/backup lama yang dapat diuji dan dibatalkan.

### Tahap 3 — Auth dan unit assignment
- Implementasi login, role, unit assignment, dan tes negatif akses antarunit.
- Jangan gunakan PIN statis sebagai kontrol keamanan utama.

### Tahap 4 — POS + dapur
- Integrasikan katalog, cart, checkout, item transaksi, printer/struk, order queue, dan kitchen display.
- Ganti antrean in-memory dengan sumber persisten.

### Tahap 5 — Resep, stok, dan akuntansi
- Master resep dan konversi unit.
- Transaksi final atomik/idempotent: penjualan, pembayaran, pengurangan stok, HPP, dan audit.
- Void/reversal dan rekonsiliasi stok.

### Tahap 6 — Laporan dan rilis
- Laporan per unit/event dan konsolidasi owner.
- Uji multiuser, transaksi serentak, koneksi terputus, duplicate retry, backup/restore, dan browser target.
- Deploy hanya setelah semua pemeriksaan CI lulus.

## 5. Tes penerimaan wajib

- Kasir unit A tidak dapat membaca/menulis data unit B meski mengubah request secara langsung.
- Penjualan 30 porsi dengan resep 1 potong ayam/porsi mengurangi stok 30 potong tepat satu kali.
- Retry/sinkronisasi transaksi yang sama tidak menggandakan penjualan, saldo, atau pengurangan stok.
- Void membuat reversal yang dapat diaudit dan memulihkan stok/saldo dengan benar.
- Laporan historis tidak berubah hanya karena stok saat ini berubah.
- Transfer antarunit tidak menggandakan pendapatan/beban saat konsolidasi.
- Pesanan yang belum selesai tetap tersedia setelah server/realtime worker restart.
- Backup dapat dipulihkan di lingkungan uji dan hasil saldo/stok dapat direkonsiliasi.

## 6. Hal yang belum terbukti

- Build produksi dan tes browser end-to-end untuk semua tiga paket belum dijalankan dalam audit ini.
- Aturan keamanan backend Firebase/Realtimedatabase tidak lengkap dalam paket yang diberikan.
- Skema final Supabase, RLS, migrasi cloud, autentikasi, resep, dan integrasi transaksi belum dibuat atau diuji.
- Nama/struktur final Bazar 1 dan Bazar 2 masih harus dimodelkan terhadap kebutuhan operasional, tanpa mengasumsikan ID baru.

## Kesimpulan

`keuangan-main` adalah fondasi yang paling tepat; `kasir-bazar` adalah sumber komponen POS/printer; `blueprintFIX` adalah referensi alur dapur. Integrasi yang aman membutuhkan satu model data, backend persisten, server-enforced permissions, transaksi idempotent, dan pengujian bertahap. Jangan menggabungkan folder mentah atau langsung menghubungkan semua layanan cloud tanpa migrasi dan kebijakan keamanan.
