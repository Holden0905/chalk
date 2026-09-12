import type { Metadata, Viewport } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import ChalkFilter from "@/components/ChalkFilter";
import ServiceWorker from "@/components/ServiceWorker";
import { condensed, display, typewriter } from "@/lib/fonts";

export const metadata: Metadata = {
  title: "Chalk",
  description: "NFL odds, ratings and results. A lens, not a picker.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Chalk" },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#1c2321",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${condensed.variable} ${typewriter.variable}`}>
      <body>
        <ChalkFilter />
        <Nav />
        <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-5 sm:px-6">{children}</main>
        <ServiceWorker />
      </body>
    </html>
  );
}
