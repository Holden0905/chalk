import type { Metadata, Viewport } from "next";
import { Cabin_Sketch, Barlow_Condensed, Courier_Prime } from "next/font/google";
import "./globals.css";
import Nav from "@/components/Nav";
import ServiceWorker from "@/components/ServiceWorker";

// Hand-lettered chalk for the frame: nav, titles, team names, big numbers.
const chalkDisplay = Cabin_Sketch({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-chalk-display",
  display: "swap",
});

// Condensed sans for everything that is not chalk and not a number in a table.
const condensed = Barlow_Condensed({
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-condensed",
  display: "swap",
});

// Typewriter for the data panels, so columns line up like a typed slip.
const typewriter = Courier_Prime({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-typewriter",
  display: "swap",
});

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
    <html lang="en" className={`${chalkDisplay.variable} ${condensed.variable} ${typewriter.variable}`}>
      <body>
        <Nav />
        <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-5 sm:px-6">{children}</main>
        <ServiceWorker />
      </body>
    </html>
  );
}
