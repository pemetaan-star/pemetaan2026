Wrapper Next.js untuk Dashboard Pemetaan Hotspot Malang 2026. Backend dan UI
Apps Script tetap berada di folder induk pada `Index.html` dan `code.gs`.

## Konfigurasi

Buat `next-app/.env.local`:

```env
NEXT_PUBLIC_GAS_WEB_APP_URL=https://script.google.com/macros/s/DEPLOYMENT_ID/exec
```

Isi URL tersebut dengan URL Web App Apps Script yang sudah dideploy, lalu jalankan:

```bash
npm run dev
```

Buka `http://localhost:3000`. Dashboard dimuat di dalam iframe sehingga
`google.script.run`, GPS, upload file, dan alur autentikasi tetap ditangani
oleh Web App Apps Script.

## Offline Enumerator

Form Enumerator menyimpan submission yang gagal dikirim, termasuk foto, di
IndexedDB perangkat. Saat koneksi kembali atau user login lagi, antrean akan
dikirim otomatis. Draft isian tetap menggunakan penyimpanan lokal yang sama
seperti sebelumnya. Offline queue berlaku untuk pengiriman form, bukan untuk
login atau pembacaan dashboard.

## PWA

Next.js menyediakan manifest dan service worker untuk instalasi ke layar utama.
Karena dashboard Apps Script dimuat dari origin berbeda, service worker Next.js
hanya meng-cache shell Next.js; data dan autentikasi tetap memerlukan Web App
Apps Script serta koneksi ke KoboToolbox.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
