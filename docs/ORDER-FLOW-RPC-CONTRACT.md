# Kontrak RPC Order Flow — Tahap 1

Status: kontrak rancangan untuk ditinjau. Nama dan signature di bawah belum ada bukti telah dibuat di database aktif. Tidak ada migration SQL atau implementasi transaksi dalam dokumen ini.

## Kebijakan umum API

- Semua nominal dan snapshot harga berasal dari database. Browser hanya mengirim ID menu, kuantitas, dan catatan; browser tidak mengirim harga, subtotal, total, atau diskon otoritatif.
- Semua operasi tulis dilakukan melalui RPC server-side. Tidak ada insert/update langsung dari browser ke tabel order, sale, atau kas.
- Setiap fungsi memeriksa `auth.uid()`, profil aktif, role, unit dan jenis unit. Non-owner dibatasi ke unit profilnya; owner hanya lintas unit sesuai aturan owner yang disetujui. Role kitchen hanya dapat melakukan perubahan status item di unitnya.
- Definisi policy aktif belum tersedia. Role check dalam fungsi tidak menggantikan pemeriksaan grants/RLS; keduanya harus ditinjau.
- Format sukses konsisten: `{ok: true, result: "created" | "existing" | "updated" | "paid", ...}`. Error dibedakan dengan kode stabil pada detail JSON atau SQLSTATE yang dipetakan oleh client, bukan dengan menampilkan detail internal database.

## Operasi

### 1. Membuat order awal — `create_kitchen_order`

**Request**

```text
p_request_id: uuid
p_unit_id: uuid
p_service_type: dine_in | takeaway
p_table_number: text | null
p_customer_label: text | null (takeaway identity; stored separately from table_number)
p_items: [{menu_item_id: uuid, quantity: numeric, item_notes: text | null}]
```

Kunci request dibuat sekali saat kasir memulai pengiriman dan disimpan sampai hasil operasi diketahui. Retry harus mengirim key dan payload bisnis yang sama.

**Validasi:** autentikasi/profil aktif; cashier hanya role/unit branch yang ditetapkan; tenant hanya bazaar yang ditetapkan; owner sesuai kebijakan; unit dan menu aktif; item tidak kosong; kuantitas positif dalam presisi kolom; service type sah; `dine_in` memerlukan nomor meja; input notes/ukuran payload dibatasi.

**Transaksi:** server menormalisasi payload, memakai unique partial index untuk mencegah root dine-in ganda, membaca nama/harga menu pada saat itu, menyimpan round root 1 dan semua item snapshots/catatan. `table_number` hanya diisi untuk dine-in; identitas takeaway disimpan di `customer_label` karena constraint database aktif mensyaratkan `table_number IS NULL` untuk takeaway. Harga/totals dihitung server.

**Response:** `{ok:true,result:"created"|"existing",order_id,order_number,round_number:1,status:"queued",payment_status:"unpaid",subtotal,total}`.

**Retry/conflict:** jika request key sudah tercatat dengan payload signature sama, kembalikan order yang sama. Jika key sama tetapi unit/meja/service/items/catatan/kuantitas berbeda, kembalikan `IDEMPOTENCY_CONFLICT`. Kegagalan sebelum commit tidak meninggalkan header tanpa item.

### 2. Menambah round — `append_kitchen_round`

**Request**

```text
p_request_id: uuid
p_root_order_id: uuid
p_items: [{menu_item_id: uuid, quantity: numeric, item_notes: text | null}]
```

**Validasi:** autentikasi dan role/unit seperti create; order yang diberikan harus bagian dari root yang benar; lock root; root unpaid dan tidak cancelled; tidak ada round cancelled pada grup (fungsi pembayaran aktif menolak seluruh grup seperti itu); menu aktif dan kuantitas valid.

**Transaksi:** normalisasi signature; jika request telah ada, bandingkan signature dan hasil; jika baru, hitung nomor round berikutnya saat lock root masih dipegang, baca harga/nama master terkini untuk item baru, buat child `kitchen_orders` dengan `parent_order_id=root.id`, dan buat items snapshot. Unique index aktif `kitchen_orders_parent_round_unique(parent_order_id, round_number)` menjadi pengaman tambahan terhadap kesalahan konkurensi.

**Response:** `{ok:true,result:"created"|"existing",order_id,root_order_id,round_number,status:"queued",payment_status:"unpaid",subtotal,total}`.

**Retry/conflict:** key/payload sama mengembalikan child yang sama. Key sama dengan payload berbeda menghasilkan `IDEMPOTENCY_CONFLICT`. Jika root telah dibayar sebelum retry yang belum pernah commit, kembalikan `ORDER_CLOSED`; jangan membuat round baru.

### 3. Status persiapan item — `set_kitchen_item_preparation`

**Request**

```text
p_item_id: uuid
p_target_status: queued | preparing | ready
```

**Status/transisi:** nilai awal `queued`; transisi sah `queued → preparing → ready`. Pemanggilan target yang sama menjadi no-op sukses (`result:"existing"`). Transisi mundur/lompatan ditolak `INVALID_STATUS_TRANSITION`; aturan reopen hanya dapat ditambah dengan otorisasi Owner dan audit terpisah.

**Validasi:** profil aktif role kitchen; item berada pada order/round yang unit-nya sama dengan unit profil. Server tidak menerima perubahan harga, kuantitas, menu, notes, pembayaran, atau kas dari role dapur. Operasi boleh memperbarui audit log dalam transaksi yang sama.

**Response:** `{ok:true,result:"updated"|"existing",item_id,order_id,preparation_status,is_prepared}`. `is_prepared` disinkronkan ke `true` hanya untuk `ready`; kolom status menjadi sumber kebenaran.

Perubahan status dapur tetap boleh dilakukan setelah dibayar sampai makanan selesai. Pembayaran tidak perlu menunggu `ready` secara default; perlu keputusan eksplisit jika operasional mengharuskan semua item siap dahulu.

### 4. Membayar root dan round valid — `pay_kitchen_order`

**Request**

```text
p_root_order_id: uuid
p_payment_method: payment_method
```

Kunci pembayaran stabil disimpan pada root `payment_request_id`. Pemanggil tidak boleh membuat key baru saat retry. Bila skema/implementasi aktif tidak menjamin nilai root stabil, tambahkan parameter key dan simpan/validasi sebelum transaksi pembayaran.

**Validasi:** role cashier/tenant pada unit dan jenis unit yang benar atau owner sesuai izin; root belum dibayar; semua child benar-benar di bawah root dan unit sama; hanya round/order yang tidak cancelled dan item yang sah masuk hitungan; metode pembayaran enum valid; satu sale belum ditautkan. `payment_request_id` yang sudah dipakai dengan method/payload lain menghasilkan `IDEMPOTENCY_CONFLICT`.

**Pembayaran aktif:** tetap menggunakan RPC yang telah ada, `pay_kitchen_order(p_order_id, p_payment_method, p_discount DEFAULT 0)`. Jangan membuat overload atau mengganti `post_sale`. Definisi aktif menjumlah subtotal header round, menyalin item snapshot ke `sale_items`, mencatat cash/audit, dan menautkan sale dalam pemanggilan yang sama. Hasil metadata menunjukkan tidak ada trigger tambahan pada tabel terkait.

**Response:** `{ok:true,result:"paid"|"existing",root_order_id,sale_id,payment_status:"paid",total,payment_method}`.

**Retry/conflict:** retry setelah commit mengembalikan sale tertaut yang sama. Retry serentak diserialisasi oleh lock root. Request key sama tapi method/payload berbeda ditolak. Order sudah paid dengan key lama yang valid mengembalikan `existing`; key baru untuk pembayaran kedua menghasilkan `ALREADY_PAID` dan ID sale yang sudah ada, tanpa membuat sale/cash kedua.

**Perbedaan aktif yang telah diverifikasi:** database saat ini memiliki `pay_kitchen_order(p_order_id uuid, p_payment_method payment_method, p_discount numeric DEFAULT 0)` dengan output `status/order_id/sale_id`. Kontrak di atas masih rancangan yang lebih ketat: implementasi aktif tidak membandingkan metode pembayaran saat retry sudah paid dan menolak grup yang berisi round cancelled. Jangan mengaktifkan UI atau menganggap kontrak ini telah dipenuhi sampai pemilik proses menyetujui penyelarasan dan perubahan yang diperlukan.

## Error contract

| Kode | Arti | Efek yang diharapkan |
|---|---|---|
| `AUTH_REQUIRED` | Tidak ada sesi terautentikasi | Tidak ada perubahan |
| `INACTIVE_PROFILE` | Profil tidak ada/tidak aktif | Tidak ada perubahan |
| `ROLE_NOT_ALLOWED` | Role tidak diizinkan untuk operasi | Tidak ada perubahan |
| `UNIT_ACCESS_DENIED` | Unit berbeda dari unit yang diizinkan | Tidak ada perubahan |
| `UNIT_KIND_MISMATCH` | Role cashier/tenant tidak sesuai branch/bazaar | Tidak ada perubahan |
| `INVALID_PAYLOAD` / `INVALID_PAYMENT_METHOD` | Payload/enum tidak sah | Tidak ada perubahan |
| `MENU_NOT_ACTIVE` | Menu tidak tersedia saat pembuatan round | Tidak ada perubahan pada operasi tersebut |
| `IDEMPOTENCY_CONFLICT` | Request key dipakai ulang dengan payload berbeda | Tidak ada perubahan |
| `ACTIVE_TABLE_ORDER_EXISTS` | Meja sudah memiliki root unpaid | Kembalikan ID root aktif atau minta client membukanya |
| `ORDER_NOT_FOUND` / `ITEM_NOT_FOUND` | ID tidak ditemukan dalam scope akses | Tidak ada perubahan |
| `ORDER_CLOSED` | Root paid/cancelled/ditutup | Tidak ada perubahan |
| `INVALID_STATUS_TRANSITION` | Transisi status item tidak diizinkan | Tidak ada perubahan |
| `ALREADY_PAID` | Pembayaran baru dicoba untuk root yang sudah paid | Jangan buat sale/cash baru |
| `INTEGRITY_ERROR` | Snapshot/relasi round/unit/linkage tidak konsisten | Rollback seluruh transaksi |

Client dapat memberi pesan aman yang sesuai kode, tanpa menampilkan SQL/stack/context internal.

## Kebutuhan skema yang diperkirakan

Perlu baseline aktif sebelum SQL ditulis. Berdasarkan keputusan bisnis, kebutuhan yang belum terbukti tersedia:

1. `kitchen_order_items.preparation_status` dengan check tiga nilai `queued`, `preparing`, `ready`, default `queued`; sinkronisasi `is_prepared` hanya saat ready.
2. `request_payload_hash` server-side untuk membedakan retry identik dan penggunaan key dengan payload berbeda.
3. `customer_label` untuk identitas takeaway karena constraint aktif mensyaratkan `table_number IS NULL`.
4. Unique partial index satu root aktif dine-in per `(unit_id, lower(table_number))`; round child sudah dilindungi indeks aktif `kitchen_orders_parent_round_unique`.
5. RPC server untuk create, append, list, dan status item; tidak ada migration pembayaran karena fungsi tersebut sudah aktif.
6. Minimum `EXECUTE` grants; policy hanya disesuaikan jika hasil review membuktikan perlu. Role kitchen tidak memperoleh hak finansial.

Item pembatalan per baris belum tersedia pada metadata. Rancangan ini mengecualikan seluruh round berstatus `cancelled`; pembatalan sebagian item memerlukan status/kolom dan audit tersendiri.

## Hal yang belum bisa dipastikan

- Policy dan grants PRODUCTION, termasuk hak operasi tulis dan batas `unit_id`.
- Definisi aktif `post_sale`, privilege `EXECUTE`, dan trigger yang mungkin sudah memodifikasi data.
- Definisi kolom lengkap, not-null/default, seluruh indeks/constraint/trigger dari tabel dapur—metadata MCP hanya menampilkan sebagian detail.
- Apakah enum `payment_method` aktif identik dengan migrasi lokal; metadata yang diterima menyebut nilai cash, bank_transfer, qris, debit, other.
- Apakah sistem memiliki data round/root ganda yang membuat unique index gagal.
- Aturan diskon, pembatalan, identitas takeaway, dan hak Owner untuk mengubah status dapur.

## Urutan verifikasi dan test

1. Gunakan definisi metadata aktif terbaru dalam `docs/ORDER-FLOW-IMPLEMENTATION-STATUS.md`; tinjau perbedaan fungsi pembayaran aktif sebelum menyetujui perilaku bisnis.
2. Siapkan baseline skema tanpa data produksi untuk database disposable/nonproduction yang disetujui. Jangan apply SQL ini ke PRODUCTION.
3. Implementasikan migration dan RPC; uji signature request, role/unit, snapshot harga setelah perubahan master, satu meja aktif, round bersamaan, dan status per item.
4. Uji atomisitas dengan fault injection setelah tiap langkah: order/header, item, sale, sale_items, cash, audit, linkage paid. Hasil harus rollback seluruhnya.
5. Uji dua payment bersamaan, timeout setelah commit sebelum response, retry key sama, key sama dengan payload berbeda, dan client retry dengan key baru.
6. Uji RLS/grants dengan role anon, cashier unit A, cashier unit B, tenant, kitchen unit A/B, owner; verifikasi tidak ada lintas-unit dan dapur tidak dapat menulis data keuangan.

Saat ini tidak tersedia database nonproduksi dalam konteks ini, maka seluruh test database di atas belum dijalankan.
