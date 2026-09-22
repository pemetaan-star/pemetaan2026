import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dashboard Pemetaan Hotspot Malang 2026",
  description: "Wrapper Next.js untuk Dashboard Pemetaan Hotspot Malang.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
