import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dashboard Pemetaan Hotspot Malang 2026",
  description: "Wrapper Next.js untuk Dashboard Pemetaan Hotspot Malang.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/lingga-indonesia-icon.svg", type: "image/svg+xml" },
    ],
    apple: "/lingga-indonesia-icon.svg",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
