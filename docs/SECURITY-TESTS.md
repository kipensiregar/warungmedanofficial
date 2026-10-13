# Checklist keamanan sebelum produksi

- [ ] Pengguna tanpa profil tidak dapat membaca data operasional.
- [ ] Pengguna nonaktif tidak dapat membaca data.
- [ ] Kasir Cabang 1 tidak dapat membaca penjualan/stok Cabang 2.
- [ ] Tenant Bazar 1 tidak dapat membaca/menulis data Bazar 2.
- [ ] Tim dapur tidak dapat membaca laporan keuangan owner.
- [ ] Pengguna tidak dapat mengubah role/unit miliknya sendiri.
- [ ] Tidak ada service-role key di bundle browser, repo, atau log.
- [ ] Penjualan tidak bisa dibuat langsung melalui REST table endpoint.
- [ ] RPC penjualan akan menghitung total di server dan menolak harga/discount palsu.
- [ ] Permintaan penjualan yang diulang dengan `client_request_id` yang sama tidak membuat transaksi kedua.
- [ ] Stok tidak pernah negatif meski dua kasir menjual bahan yang sama bersamaan.
- [ ] Void membuat reversal yang dapat diaudit.
- [ ] Audit log tidak dapat diubah/hapus oleh staf.
- [ ] Backup dan restore sudah diuji pada proyek non-produksi.
