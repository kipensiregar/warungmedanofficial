# Order Flow — Urutan Review, Pengujian, dan Penerapan

Status: paket lokal untuk ditinjau; belum diterapkan. Project Supabase aktif berlabel PRODUCTION. Jangan menerapkan berkas ini ke production berdasarkan dokumen ini saja.

## Urutan berkas

1. `supabase/review-only-migrations/20261021_order_flow_schema_prerequisites.sql`
   - Menambahkan `preparation_status`, `request_payload_hash`, dan `customer_label`.
   - Menyelaraskan status lama dari `is_prepared`, lalu menambah constraint/index setelah preflight duplikasi.
2. `supabase/review-only-migrations/20261021_order_flow_rpc_draft.sql`
   - Membuat RPC create, append, list, dan perubahan status item.
   - Semua fungsi memeriksa sesi, role, dan unit; operasi tulis berjalan dalam transaksi pemanggilan RPC.
   - Mencabut EXECUTE dari `PUBLIC`, `anon`, dan `authenticated` di transaksi yang sama dengan pembuatan fungsi, sehingga tidak ada jendela akses publik.
3. `supabase/review-only-migrations/20261021_order_flow_permissions_draft.sql`
   - Memberi EXECUTE hanya kepada `authenticated`, setelah signature RPC tersedia.
   - Tidak mengubah RLS, policy, atau grant tabel.

Ketiganya sengaja berada di luar `supabase/migrations` agar tidak diterapkan otomatis. Urutan aman adalah schema → RPC (tetap tidak bisa dipanggil role aplikasi) → permission. Setiap file memiliki transaksi sendiri; kegagalan pada file berikutnya tidak membatalkan file sebelumnya. Setelah review, masukkan ke sistem migrasi yang disetujui dengan nomor urut baru. Jangan menjalankan file review langsung pada project aktif.

Paket review berisi tiga draft SQL dan tidak memiliki migrasi pembayaran: gunakan fungsi aktif `public.pay_kitchen_order(p_order_id uuid, p_payment_method payment_method, p_discount numeric DEFAULT 0)`. Client lokal memetakan root order ke `p_order_id`, tidak mengirim diskon sehingga default diskon nol digunakan, dan mengenali status `paid`/`already_paid`. Fungsi aktif menolak grup dengan round berstatus cancelled. Jangan membuat overload atau mengubah fungsi tersebut.

## Pengujian yang wajib dilakukan pada database disposable

- Membuat order awal: menu aktif menyimpan nama/harga snapshot; menu tidak aktif, payload kosong, kuantitas invalid, role salah, unit lain, dan jenis unit salah ditolak.
- Idempotensi create/append: key dan payload sama mengembalikan ID yang sama; key sama dengan payload berbeda menghasilkan conflict; retry paralel tidak membuat header/item ganda.
- Harga dan round: perubahan harga menu setelah order awal tidak mengubah item lama; tambahan membaca harga terbaru; dua append bersamaan menghasilkan nomor round berbeda dan tetap berurutan.
- Meja: hanya satu root dine-in unpaid per unit/meja; meja yang sama boleh dipakai lagi setelah order lama ditutup/dibatalkan sesuai predikat index.
- Dapur: transisi `queued → preparing → ready`, retry status sama, transisi mundur, item lintas unit, profil tidak aktif, dan order cancelled; perubahan status tercatat bersama audit.
- List: hanya unit terotorisasi yang terlihat; status cancelled yang masih unpaid tetap terlihat agar UI dapat memblokir pembayaran yang ditolak fungsi pembayaran aktif.
- Kompatibilitas bayar aktif: satu pembayaran menghasilkan satu sale/cash movement dan menghubungkan seluruh round; retry menghasilkan `already_paid`; grup dengan round cancelled ditolak; diskon total nol menguji konflik dengan constraint kas `amount_delta <> 0`.
- Atomisitas: paksa kegagalan setelah insert header, item, sale, sale item, kas, audit, dan linkage; pastikan tidak ada bagian transaksi tertinggal.

Belum ada database disposable/baseline kitchen lokal atau parser SQL terpasang yang terverifikasi pada sesi ini. Test matrix di atas belum dijalankan. Build frontend tidak memvalidasi PL/pgSQL.

## Dampak dan rollback per kelompok

- **Schema:** menambah kolom dan index; juga melakukan backfill `preparation_status` dari `is_prepared`. Dampaknya meliputi penyimpanan status/label/hash baru serta penolakan root dine-in ganda oleh unique index. Jika file gagal, transaksinya rollback sendiri. Rollback manual dapat menghapus index; penghapusan kolom berisiko membuang label takeaway, idempotency hash, dan status baru, sehingga hanya layak sebelum digunakan atau setelah pemindahan data dan pemeriksaan dependensi.
- **RPC:** membuat empat fungsi `SECURITY DEFINER`, tetapi pada akhir transaksi akses tetap dicabut dari `PUBLIC`, `anon`, dan `authenticated`. Jika gagal, transaksi file rollback. Setelah berhasil, fungsi tetap tidak dapat dipanggil oleh aplikasi sampai tahap permission. Rollback dengan `DROP FUNCTION` berdasarkan empat signature persis, setelah pemanggilan dihentikan.
- **Permission:** hanya memberi `EXECUTE` kepada `authenticated`; tidak membuka hak tulis tabel dan tidak mengubah RLS. Rollback dengan `REVOKE EXECUTE` dari `authenticated`. Jalankan rollback permission sebelum menghapus fungsi.

File schema, RPC, dan permission berkomit terpisah. Karena itu, penerapan berurutan tidak atomik sebagai satu paket. Setelah fungsi digunakan, rollback schema tidak dapat dianggap aman tanpa menghentikan pemanggilan, menilai data yang telah tercipta, dan mencadangkan kolom yang akan dibuang.

## Rollback konseptual

Jika uji gagal, pertahankan `KITCHEN_ORDER_BACKEND_READY = false`; jangan deploy client yang memanggil endpoint tersebut. Pada lingkungan uji, rollback permission dahulu, hapus fungsi baru sesuai signature, lalu rollback index. Hapus kolom hanya setelah memastikan tidak ada dependensi dan data yang perlu dipertahankan. Jangan menghapus `customer_label`, `preparation_status`, atau request hash dari production tanpa review data dan persetujuan terpisah. Fungsi pembayaran aktif dan `post_sale` tidak diubah oleh paket ini.
