import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import Navbar from "@/components/Navbar";
import InstallPrompt from "@/components/InstallPrompt";
import SmoothScroll from "@/components/SmoothScroll";
import { STORAGE_KEY } from "@/lib/theme";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
});

const body = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "SPARKServ, Appliance Repair Management System",
  description: "Connecting customers with trusted appliance repair technicians.",
  icons: {
    icon: "/icons/icon.svg",
    apple: "/icons/apple-touch-icon.png",
  },
};

/**
 * `viewportFit: "cover"` is what makes `env(safe-area-inset-bottom)` resolve to a
 * real number on a notched phone. Without it the bottom navigation and the
 * sticky form actions sit under the home indicator, where they are partly
 * unreachable. `themeColor` themes the Android/iOS browser chrome to match the
 * app canvas so the page does not read as a letterboxed web page on a phone.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  /* A single entry, deliberately NOT media-scoped: this is the Android/iOS
     browser-chrome colour, and with a class-based toggle the OS is no longer
     what decides the theme. The pre-paint script below and `applyTheme` in
     ThemeProvider rewrite this meta at runtime so the chrome follows the toggle. */
  themeColor: "#F5F7FB",
};

/**
 * Theme pre-paint script. A plain inline `<script>` as the first body child runs
 * before React hydrates and before the first paint: the stored choice wins,
 * otherwise the OS preference. Without it a dark-mode visitor gets a white
 * flash, and `suppressHydrationWarning` on `<html>` would only hide the React
 * warning, not fix the flash. It writes the same `dark` class, `color-scheme`
 * and storage key `ThemeProvider` reads, `STORAGE_KEY` comes from
 * `src/lib/theme.ts`, a plain module, because importing the value out of the
 * client `ThemeProvider` here would interpolate a client reference object and
 * render `var key = "[object Object]"`. It lives in the body rather than a
 * `<head>` element so the App Router leaves it exactly here instead of hoisting
 * and re-parenting it.
 */
const THEME_PRE_PAINT = `
(function () {
  try {
    var key = "${STORAGE_KEY}";
    var stored = null;
    try { stored = localStorage.getItem(key); } catch (e) {}
    /* Light is the default: 'prefers-color-scheme' is deliberately NOT consulted,
       so an OS set to dark cannot override the toggle's stored choice. */
    var dark = stored === "dark";
    var el = document.documentElement;
    el.classList.toggle("dark", dark);
    el.style.colorScheme = dark ? "dark" : "light";
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#080D1A" : "#F5F7FB");
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="bg-canvas font-sans text-ink antialiased">
        <script dangerouslySetInnerHTML={{ __html: THEME_PRE_PAINT }} />
        <ThemeProvider>
          <Navbar />
          {/* Smooth scrolling wraps the page content only: the navbar is `sticky`
              and the install prompt is a fixed overlay, and neither wants to sit
              inside a component that manages the scroll position. `SmoothScroll`
              renders a fragment, so this adds no element to the tree. */}
          <main>
            <SmoothScroll>{children}</SmoothScroll>
          </main>
          {/* The install offer only appears when the browser says the app is
              installable and the visitor has not dismissed it, see the component. */}
          <InstallPrompt />
        </ThemeProvider>
      </body>
    </html>
  );
}
