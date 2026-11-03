
import type { Metadata, Viewport } from "next";
import Navbar from "@/components/Navbar";
import InstallPrompt from "@/components/InstallPrompt";
import { STORAGE_KEY } from "@/lib/theme";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "SPARKServ, Appliance Repair Management System",
  description: "Connecting customers with trusted appliance repair technicians.",
  icons: {
    icon: "/icons/icon.svg",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F7FB" },
    { media: "(prefers-color-scheme: dark)", color: "#080D1A" },
  ],
};

const THEME_PRE_PAINT = `
(function () {
  try {
    var key = "${STORAGE_KEY}";
    var stored = null;
    try { stored = localStorage.getItem(key); } catch (e) {}
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var dark = stored === "dark" || (!stored && prefersDark);
    var el = document.documentElement;
    el.classList.toggle("dark", dark);
    el.style.colorScheme = dark ? "dark" : "light";
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-canvas font-sans text-ink antialiased">
        <script dangerouslySetInnerHTML={{ __html: THEME_PRE_PAINT }} />
        <ThemeProvider>
          <Navbar />
          <main>{children}</main>
          <InstallPrompt />
        </ThemeProvider>
      </body>
    </html>
  );
}
