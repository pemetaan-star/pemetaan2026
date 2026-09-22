"use client";

import { useEffect } from "react";

const gasWebAppUrl = process.env.NEXT_PUBLIC_GAS_WEB_APP_URL;

export default function Home() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  return (
    <main className="shell">
      {gasWebAppUrl ? (
        <iframe
          className="dashboard-frame"
          src={gasWebAppUrl}
          title="Dashboard Pemetaan Hotspot Malang"
          allow="geolocation; camera"
        />
      ) : (
        <section className="setup-card" aria-labelledby="setup-title">
          <div className="brand-mark" aria-hidden="true">⌖</div>
          <p className="eyebrow">Next.js wrapper</p>
          <h1 id="setup-title">Dashboard Pemetaan Hotspot Malang</h1>
          <p>
            Hubungkan halaman ini ke Web App Google Apps Script untuk membuka
            dashboard dan mempertahankan seluruh alur Kobo, Spreadsheet, serta
            Drive yang sudah tersedia.
          </p>
          <div className="command-box">
            <span>NEXT_PUBLIC_GAS_WEB_APP_URL=</span>
            <strong>https://script.google.com/macros/s/.../exec</strong>
          </div>
          <p className="hint">
            Simpan nilai tersebut di <code>.env.local</code>, lalu jalankan
            kembali server Next.js.
          </p>
        </section>
      )}
    </main>
  );
}
