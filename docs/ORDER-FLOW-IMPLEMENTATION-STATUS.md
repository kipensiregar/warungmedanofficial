# Order Flow — Implementasi dan Batas Aktivasi

Status: frontend draft dan kontrak client disiapkan; order flow produksi belum aktif. Database aktif berlabel PRODUCTION. Jangan aktifkan `KITCHEN_ORDER_BACKEND_READY` sebelum review objek produksi dan penerapan migration melalui proses yang disetujui.

## Fakta skema dari metadata

- `public.kitchen_orders` dan `public.kitchen_order_items` ada; RLS dilaporkan aktif.
- Header memiliki `client_request_id` unik, `payment_request_id` unik, `unit_id`, `created_by`, `status`, `payment_status`, total, `paid_sale_id`, `parent_order_id`, dan `round_number`.
- Item memiliki `menu_item_id`, `menu_name_snapshot`, `quantity`, `unit_price`, `line_total`, `item_notes`, dan `is_prepared`.
- FK yang dilaporkan: header ke unit, pengguna pembuat, sale, serta parent header; item ke header dan menu.
- Metadata tool tidak mengembalikan definisi policy, RPC aktif, trigger, grants, atau indeks unik gabungan. Maka role/unit enforcement dan efek trigger belum dapat dinilai.
- Migrasi lokal initial schema tidak membuat tabel dapur dan bukan baseline production yang dapat diterapkan dari nol. Migration production harus disusun setelah baseline/objek aktif diverifikasi.

## Kontrak client yang disiapkan

`src/features/orders/kitchen-order-api.ts` menetapkan nama endpoint usulan:

- `create_kitchen_order`: membuat header awal dan item snapshot.
- `append_kitchen_round`: menambah round ke root order dan menyimpan snapshot harga baru.
- `list_kitchen_orders`: membaca antrean dalam satu unit terotorisasi.
- `set_kitchen_item_preparation`: mengubah status per item.
- `pay_kitchen_order`: membayar seluruh item valid menggunakan snapshot order.

Empat RPC create/append/list/status adalah kontrak lokal dan belum tersedia di production. `pay_kitchen_order` berbeda: fungsi dengan signature aktif telah diverifikasi dan adapter lokal mengikuti argumennya. `post_sale` tidak digunakan oleh order flow.

Draft SQL untuk review terletak di luar `supabase/migrations` agar tidak ikut urutan apply biasa:

- `supabase/review-only-migrations/20261021_order_flow_schema_prerequisites.sql`
- `supabase/review-only-migrations/20261021_order_flow_rpc_draft.sql`
- `supabase/review-only-migrations/20261021_order_flow_permissions_draft.sql`

Ketiga file tersebut belum pernah dijalankan atau diverifikasi dengan parser/database. Permission EXECUTE dipisah dan baru diberikan setelah RPC tersedia; tidak ada migration pembayaran karena fungsi aktif dipertahankan tanpa overload baru. Urutan review dan test ada di `docs/ORDER-FLOW-DEPLOYMENT.md`. Berkas di folder review bukan migration siap deploy.

## Prasyarat database sebelum implementasi server

1. Gunakan baseline metadata aktif terbaru; empat RPC order yang baru belum ditemukan.
2. Tambahkan status persiapan item, hash payload, dan `customer_label` setelah baseline nonproduction disetujui.
3. Pertahankan indeks round child aktif; tambahkan hanya unique root dine-in setelah preflight data.
4. Tambahkan RPC create/append/list/status dengan `SECURITY DEFINER`, `search_path` tetap, validasi profil/role/unit, serta grant `EXECUTE` minimum. Browser tidak menulis langsung ke tabel.
5. Pertahankan `pay_kitchen_order` aktif dan review perbedaan perilaku pembatalan/retry sebelum UI pembayaran diaktifkan.

## Perilaku aplikasi saat ini

- Draf kasir memvalidasi meja, item, kuantitas, dan catatan serta menghitung estimasi dari harga menu yang dimuat.
- Harga pada browser hanya estimasi; harga final wajib dipilih dan disimpan oleh server ketika operasi order/round dijalankan.
- Tombol kirim secara eksplisit tetap nonaktif melalui flag `KITCHEN_ORDER_BACKEND_READY = false`.
- Jalur client untuk create/append/list/status/payment dan halaman antrean sudah disiapkan, tetapi semua pemanggilan order tetap di-gate oleh flag false.
- Saat flag false, client tidak memanggil RPC antrean/order. Halaman owner juga tidak memuat daftar unit khusus antrean.
- Tidak ada query order dapur yang dijalankan saat implementasi ini.

## Pengujian sebelum aktivasi

Database test belum dapat dijalankan terhadap production dan tidak ada baseline lokal kitchen untuk integration test. Setelah baseline nonproduction yang dapat dipercaya tersedia, uji: role/unit lintas cabang, snapshot ketika harga master berubah, retry setelah timeout, request key dengan payload berbeda, round bersamaan, perubahan status per item, pembayaran bersamaan, dan rollback setelah kegagalan pada setiap langkah sale/cash/audit/linkage.

## Audit metadata aktif — 2026-10-21

Pemeriksaan katalog read-only pada tabel order, sale, dan kas menemukan:

- Fungsi order create/append/list/status yang diminta client tidak ditemukan di `public` pada hasil pencarian fungsi yang relevan. Fungsi pembayaran aktif **ada** sebagai `public.pay_kitchen_order(uuid, payment_method, numeric DEFAULT 0)`, SECURITY DEFINER, EXECUTE untuk `authenticated`; signature/argumen pertama aktif adalah `p_order_id`, bukan `p_root_order_id`. Responsnya memakai `status`, `order_id`, dan `sale_id`, termasuk `already_paid`, bukan envelope `ok/result` client draft.
- Fungsi pembayaran aktif langsung menulis `sales`, `sale_items`, `cash_movements`, audit, lalu menautkan order. Ia tidak memanggil `post_sale`. Tidak ada non-internal trigger pada `kitchen_orders`, `kitchen_order_items`, `sales`, `sale_items`, atau `cash_movements` dalam hasil metadata.
- `post_sale(uuid, uuid, payment_method, jsonb, numeric DEFAULT 0)` juga aktif dan EXECUTE untuk `authenticated`; ia membaca harga menu saat RPC dijalankan, membuat sale paid dan cash movement. Jangan gunakan untuk order dapur yang memakai snapshot.
- Policy SELECT untuk order, item, sales, sale_items, dan kas membatasi melalui `is_active_user()`/`can_access_unit(...)`. Policy UPDATE pada item mengizinkan baris dalam unit yang dapat diakses, tetapi policy tidak membatasi kolom yang boleh diubah. Metadata `role_table_grants` tidak mengembalikan hak tabel langsung untuk `authenticated`, `anon`, atau `PUBLIC`; RLS juga tidak dipaksa pada tabel yang diperiksa. Tidak ada policy INSERT/UPDATE header order atau policy INSERT items/sales/sale_items. Ini tidak dengan sendirinya memblokir RPC SECURITY DEFINER.
- `cash_movements` memiliki unique `(movement_type, source_type, source_id)` dan CHECK `amount_delta <> 0`. Fungsi pembayaran aktif menulis `sale_income/sale/<sale_id>`; fungsi `post_sale` lokal memakai identitas source yang sama. Tidak ada trigger yang terverifikasi menggandakan movement, tetapi total nol akan ditolak oleh CHECK jika fungsi tetap mencoba mencatat kas.
- Constraint aktif mewajibkan takeaway menyimpan `table_number IS NULL`. Karena itu draf client/SQL yang mengirim identitas takeaway lewat `table_number` tidak kompatibel. Draft lokal kini memisahkan `customer_label`; kolom ini belum ada pada skema aktif dan memerlukan migration yang belum dijalankan.
- Indeks aktif `kitchen_orders_parent_round_unique(parent_order_id, round_number) WHERE parent_order_id IS NOT NULL` sudah menjamin nomor round unik untuk child. Draft tidak lagi menambahkan indeks tambahan yang redundan untuk pasangan root/round.
- Fungsi pembayaran aktif menolak seluruh grup jika ada round cancelled; draft pembayaran lokal sebelumnya mengecualikan round cancelled. Fungsi aktif juga mengembalikan `already_paid` tanpa membandingkan metode pembayaran retry. Jangan menganggap kontrak pembayaran draft sama dengan implementasi aktif.

Draft pembayaran yang membuat overload baru telah dihapus. Paket lokal sekarang hanya berisi prasyarat skema dan RPC nonfinansial; dokumentasi deployment menegaskan bahwa fungsi pembayaran aktif tidak diganti.
