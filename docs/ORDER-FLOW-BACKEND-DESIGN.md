# Desain Backend Order Kasir → Dapur → Pembayaran

Status: rancangan untuk ditinjau. Bukan implementasi, bukan migration yang siap dijalankan. Tidak ada SQL atau perubahan database yang dilakukan.

## Dasar bukti

- `src/App.tsx` memanggil `post_sale` dari `submitSale`, membuat `crypto.randomUUID()` untuk setiap submit, lalu membersihkan keranjang setelah respons sukses.
- `supabase/migrations/202610130001_initial_schema.sql` mendefinisikan `post_sale`: validasi user aktif/role/unit, baca harga menu aktif di database, buat `sales` berstatus `paid`, `sale_items`, `cash_movements`, dan `audit_logs`. Fungsi menerima `p_client_request_id` yang unik pada `sales`.
- Metadata aktif mengonfirmasi tabel `kitchen_orders` dan `kitchen_order_items`, status order dan pembayaran, harga/nama snapshot item, `item_notes`, `is_prepared`, `parent_order_id`, `round_number`, `paid_sale_id`, `client_request_id`, dan `payment_request_id`, serta PK/FK/unique/check constraint yang dilaporkan MCP.
- Metadata RLS hanya mengonfirmasi flag `rls_enabled`; definisi policy, fungsi/RPC aktif, trigger, dan seluruh constraint tidak tersedia dari tool yang dipakai.
- Migrasi lokal tidak mendefinisikan tabel dapur. MCP `list_migrations` mengembalikan daftar kosong. Karena itu file lokal bukan baseline yang cukup untuk menghasilkan SQL operasional terhadap database aktif.

## Kontrak operasi yang direkomendasikan

Keputusan tahap 1 menetapkan status persiapan per item, harga immutable per pengiriman, satu root aktif per meja, tambahan sebagai round dalam root yang sama, dan pembayaran belakangan. Rincian input/output, error, transisi, dan retry diperluas di `docs/ORDER-FLOW-RPC-CONTRACT.md`.

Semua operasi tulis harus berupa RPC server-side dengan `SECURITY DEFINER` yang ditinjau, `search_path` tetap, hak `EXECUTE` minimum, dan pemeriksaan role/unit di dalam fungsi. Detail ini rancangan, bukan bukti konfigurasi aktif. Browser tidak boleh menulis langsung ke tabel dapur atau tabel keuangan.

### 1. `create_kitchen_order`

**Input:** `p_request_id` UUID stabil untuk satu percobaan logis; `p_unit_id`; `p_service_type`; `p_table_number`/identitas takeaway; catatan order opsional; daftar item `{menu_item_id, quantity, item_notes}`.

**Validasi server:** user terautentikasi dan profil aktif; cashier hanya branch pada unit profilnya, tenant hanya bazaar pada unit profilnya, owner sesuai aturan lintas-unit aktif; unit/menu aktif; jumlah positif; `dine_in` memiliki identitas meja; batas panjang catatan dan payload.

**Efek atomik:** buat root `kitchen_orders` round 1 berstatus `queued`/`unpaid`, hitung harga dan subtotal server-side, simpan snapshot nama/harga serta semua `kitchen_order_items`. Kegagalan satu insert membatalkan seluruh operasi.

**Output:** `{order_id, order_number, round_number: 1, status, payment_status, subtotal, total, result: created|existing}`.

**Idempotensi:** `client_request_id` harus unik dan dipakai ulang dengan payload yang sama saat timeout. Jika kunci sudah ada, server mencocokkan identitas order dan seluruh item/catatan; payload berbeda menghasilkan konflik, bukan sukses semu. Kunci saat ini mendukung keunikan order, tetapi MCP tidak menunjukkan pemeriksaan kesamaan payload.

### 2. `append_kitchen_round`

**Input:** `p_request_id` UUID stabil per tambahan; `p_root_order_id`; daftar item `{menu_item_id, quantity, item_notes}`.

**Validasi server:** role/unit sama seperti pembuatan; kunci row root dengan `FOR UPDATE`; root masih `unpaid`, bukan `cancelled`, bukan sudah ditutup; seluruh round dalam grup berada pada unit yang sama; menu aktif dan kuantitas valid.

**Efek atomik:** alokasikan `round_number = max(round_number)+1` di bawah lock root, buat child order dengan `parent_order_id=root.id`, hitung snapshot harga di server, simpan child items. Perintah ulang dengan kunci dan payload sama mengembalikan child yang telah dibuat; kunci sama dengan isi berbeda ditolak.

**Output:** `{order_id, root_order_id, round_number, status, payment_status, subtotal, total, result: created|existing}`.

**Timeout:** client mempertahankan `p_request_id` dan payload sampai hasil diketahui. Retry tidak membuat round baru. Lock root mencegah dua tambahan mengambil nomor round yang sama; unique constraint round tetap direkomendasikan sebagai pertahanan tambahan.

### 3. `set_kitchen_item_preparation`

**Input:** `p_item_id`, `p_target_status` (`queued`, `preparing`, `ready`). Metadata hanya membuktikan `is_prepared` boolean pada item, bukan status bertahap.

**Perubahan skema yang diperlukan:** tambahkan status persiapan per item dengan nilai terbatas `queued` → `preparing` → `ready`. Pertahankan `is_prepared` untuk kompatibilitas dan sinkronkan menjadi `true` hanya saat `ready`, atau rencanakan deprecate terpisah setelah semua pemakai ditemukan. Jangan menafsirkan `is_prepared=false` sebagai bukti item sedang menunggu; dapat juga sedang diproses.

**Validasi server:** role `kitchen` aktif, unit profil sama dengan root order, item berada dalam round di root tersebut, dan transisi diizinkan. Dapur tidak mengubah harga, kuantitas, catatan, metode pembayaran, atau kas. Perubahan status item dan audit log satu transaksi.

**Output:** `{item_id, order_id, preparation_status, is_prepared, result: updated|existing}`. Pengiriman target yang sama berulang idempoten. Transisi mundur atau lompatan status ditolak kecuali ada aturan koreksi khusus yang kelak disetujui.

### 4. `pay_kitchen_order`

**Input:** `p_root_order_id`, `p_payment_method`, kunci pembayaran stabil (disarankan memakai `payment_request_id` root yang sudah tersimpan, atau parameter request yang divalidasi terhadapnya), diskon hanya jika alur bisnis mengizinkannya.

**Validasi server:** cashier/tenant unit sendiri dan jenis unit yang sesuai, atau owner; root masih unpaid; tidak ada round/item batal yang dihitung; seluruh child milik root dan unit sama; metode pembayaran valid; belum ada sale yang tertaut; cek eligibility dapur sesuai keputusan bisnis. Fungsi mengunci root dan rounds untuk mencegah pembayaran bersamaan.

**Output:** `{order_id, sale_id, payment_status: paid, total, result: paid|existing}`.

**Idempotensi:** satu payment key per root. Retry setelah timeout memeriksa status dan `paid_sale_id`, lalu mengembalikan sale yang sama. Jangan membuat UUID baru untuk retry. Sale dan linkage diverifikasi sebelum mengembalikan `existing`.

## Batas atomik pembayaran

Satu pemanggilan RPC PostgreSQL dapat mengikat seluruh langkah di transaksi yang sama: lock order group → cek status dan total → buat satu `sales` → buat seluruh `sale_items` → buat satu `cash_movements` → catat `audit_logs` → set `paid_sale_id`, `payment_status='paid'`, `paid_at` pada order/round yang ditentukan. Jika satu langkah gagal, exception harus menggagalkan seluruh statement sehingga tidak ada sale/kas yang tertinggal tanpa order paid.

**Ini belum tersedia atau terbukti.** Fungsi lokal `post_sale` menggabungkan `sales`, `sale_items`, `cash_movements`, dan audit, tetapi langsung menandai sale paid; ia tidak menerima ID order dapur, tidak menautkan `paid_sale_id`, dan tidak memperbarui `payment_status`. Ia juga membaca harga menu saat pembayaran, sedangkan order dapur menyimpan snapshot harga. Jika harga menu berubah setelah order dibuat, hasil `post_sale` dapat berbeda dari total yang disepakati saat pemesanan.

Sebelum implementasi, putuskan kebijakan snapshot harga dan hindari dua implementasi finansial yang menyimpang. Rekomendasi: refactor mekanisme posting penjualan menjadi helper internal bersama yang menerima baris harga tervalidasi server-side; pertahankan kontrak RPC `post_sale` lama sebagai wrapper kompatibel, dan gunakan helper yang sama dari RPC bayar order dengan snapshot harga order. Semua operasi tetap harus berjalan di transaksi panggilan RPC yang sama.

## Kecukupan skema: fakta dan kebutuhan tambahan

| Area | Fakta metadata | Kesimpulan desain |
|---|---|---|
| Round dan pengelompokan | `parent_order_id` self-FK dan `round_number` tersedia | Cukup untuk merepresentasikan root/child secara struktural; makna, aturan nomor, dan query aktif belum dibuktikan. |
| Item dan catatan | Item punya FK order/menu, quantity, `unit_price`, `line_total`, snapshot nama, `item_notes` | Mampu menyimpan detail/catatan/harga snapshot. Kewenangan insert dan validasi harga belum terbukti. |
| Status dapur | Order memiliki status terbatas; item punya `is_prepared` boolean | Keputusan bisnis sekarang per item; dibutuhkan kolom status item bertahap. `is_prepared` dapat disinkronkan dengan status `ready`. |
| Pembayaran | Order memiliki `payment_status`, `paid_sale_id`, `payment_request_id`; FK sale; payment request unik | Dapat menyimpan hasil pembayaran dan kunci unik; tidak membuktikan ada fungsi yang menyinkronkannya secara atomik. |
| Idempotensi order | `client_request_id` unik di kitchen order | Mendukung satu order per key; tidak menyimpan hash payload, jadi pemeriksaan kunci ulang harus membandingkan isi atau menambah ledger/hash. |
| Satu order aktif/meja | Tidak ada unique constraint tersebut dalam metadata yang terlihat | Perlukan unique partial index/constraint untuk root order aktif per unit dan identitas meja, setelah aturan takeaway/identitas disepakati. |
| Round unik | `round_number` memiliki check minimum 1, tetapi unique per root tidak terlihat | Perlukan unique index `(unit_id, root_order_id, round_number)` dengan normalisasi root, atau mekanisme setara. |
| Kas sekali | `cash_movements` punya unique `(movement_type, source_type, source_id)` | Pertahanan duplikasi jika setiap pembayaran memakai source stabil. Belum mengikat source ke order dan belum membuktikan RPC aktif memakainya. |
| Total | Order menyimpan subtotal/discount/total; item menyimpan line_total | Perlu satu aturan server untuk menjumlah snapshot dan menerapkan diskon. Tidak boleh percaya total dari browser. |

## Definisi aktif yang perlu diperiksa manual

Daftar pendek objek yang belum terjawab—tanpa meminta pengulangan audit tabel/kolom/FK:

1. Policies untuk `public.kitchen_orders` dan `public.kitchen_order_items` (SELECT/INSERT/UPDATE/DELETE, `USING`, `WITH CHECK`, target role).
2. Policies untuk `public.sales`, `public.sale_items`, dan `public.cash_movements` (khususnya hak tulis dan batas unit).
3. Definisi aktif `public.post_sale(uuid, uuid, public.payment_method, jsonb, numeric)` dan daftar role yang mendapat `EXECUTE`.
4. Daftar/definisi fungsi aktif yang menyebut `kitchen_orders`, `kitchen_order_items`, `payment_request_id`, `paid_sale_id`, `parent_order_id`, atau `round_number`.
5. Trigger yang terpasang pada lima tabel alur transaksi, termasuk fungsi trigger dan tabel/kolom yang disentuh.
6. Unique index/constraint aktif untuk order aktif per meja dan round per root bila ada.

## Rencana migrasi terpisah (belum dibuat/dijalankan)

Belum aman menulis migration SQL operasional: migrasi lokal tidak membuat tabel dapur dan metadata MCP tidak memberikan definisi policy/fungsi/trigger aktif. Migration yang merujuk struktur ini belum dapat diuji lokal, dan berisiko menimpa atau menduplikasi aturan PRODUCTION.

Setelah baseline database aktif ditinjau dan tersedia di lingkungan nonproduksi, migration terpisah kemungkinan berisi:

1. Constraint/index untuk root aktif per identitas unit/meja dan nomor round unik.
2. Kolom status persiapan per item dengan check constraint dan strategi transisi kompatibilitas untuk `is_prepared`.
3. Penyimpanan signature payload request order/round agar penggunaan ulang `client_request_id` dengan payload berbeda menghasilkan konflik.
4. RPC `create_kitchen_order`, `append_kitchen_round`, status dapur per item, dan `pay_kitchen_order` dengan validasi role/unit, lock row, dan audit.
5. Helper posting sale yang menjaga kompatibilitas `post_sale` dan memasukkan sale/cash/link pembayaran dalam transaksi tunggal menggunakan snapshot order.
6. Grants/revokes `EXECUTE` minimum dan, hanya jika dibutuhkan setelah policy ditinjau, policy tabel per role/unit. Tidak ada broadening RLS sebagai jalan pintas.
7. Validasi precondition di awal migration agar deployment berhenti jika skema/constraint baseline berbeda, kemudian test di Supabase lokal atau staging.

## Urutan implementasi aman

1. Dapatkan definisi objek pada daftar manual di atas dari Dashboard dan cocokkan dengan migrasi lokal.
2. Siapkan baseline schema dan salinan migration di lingkungan lokal/staging, bukan PRODUCTION.
3. Putuskan aturan identitas takeaway, diskon, pembatalan round/item, eligibility pembayaran, serta siapa yang boleh memperbaiki status dapur.
4. Buat migration terpisah serta test SQL/integration untuk operasi atomik dan idempotensi; review akses dengan role cashier, tenant, kitchen, owner lintas-unit.
5. Baru implementasikan UI kasir/dapur yang memanggil kontrak RPC stabil, lalu uji timeout, klik ganda, race round, pembayaran ganda, dan kegagalan di tengah transaksi.

## Validasi tahap ini

Panel awal order dapur tersedia di `src/features/orders/KitchenOrderComposer.tsx`. Panel hanya menyimpan draf di state halaman; tombol kirim nonaktif dan daftar order aktif tidak mengambil data. Tidak ada order palsu atau klaim transaksi tersimpan. Form pembayaran lama dan RPC `post_sale` tidak diubah.

Dokumen ini disusun dari pembacaan kode/migrasi dan metadata. Tidak ada SQL dijalankan, tidak ada query baris, perubahan database, deployment, atau perubahan konfigurasi. Migration SQL belum dibuat karena objek aktif dan baseline lokal belum cukup untuk memvalidasi migration yang aman.
