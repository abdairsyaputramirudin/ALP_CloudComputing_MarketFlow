# MarketFlow - ALP Cloud Computing

MarketFlow adalah website marketplace sederhana untuk kebutuhan tugas ALP Cloud Computing.
Website ini memisahkan katalog menjadi 3 modul: Produk, Jasa, dan Sewa Barang.

## Tech Stack

- HTML
- CSS
- JavaScript (ES Module)
- Bootstrap 5
- Firebase Authentication
- Firebase Realtime Database
- Deploy: Netlify

## Fitur Utama

- Register, login, dan email verification via Firebase Authentication.
- 12 CRUD pada Firebase Realtime Database:
  - Produk (Create, Read, Update, Delete)
  - Jasa (Create, Read, Update, Delete)
  - Sewa Barang (Create, Read, Update, Delete)
- Role admin dan user dipisah.
- Order management:
  - Status pembayaran
  - Status proses produk/jasa/sewa
  - Filter dan pencarian order
  - Catatan admin ke user
  - Cancel/hapus order oleh admin (stok produk otomatis kembali)
- Metode pembayaran transfer manual dan QRIS.

## Struktur Folder

- `assets/css` - stylesheet
- `assets/js` - logic frontend dan integrasi Firebase
- `pages` - halaman admin dan user

## Cara Menjalankan (Local)

1. Pastikan config Firebase sudah diisi di file `assets/js/firebase-config.js`.
2. Jalankan project dengan local server (contoh Live Server di VS Code).
3. Buka halaman melalui `index.html`.

## Akun dan Pengujian

- Admin menggunakan email yang didaftarkan sebagai admin pada Firebase.
- User dapat register sendiri dan verifikasi email sebelum login.

## Catatan

Repository ini dipakai bertahap berdasarkan progress checkpoint ALP.
Commit/branch checkpoint terbaru saat ini: **checkpoint-4**.
