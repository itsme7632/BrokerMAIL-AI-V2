import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/context/ThemeContext";
import { Moon, Sun, Truck } from "lucide-react";
import { Logo } from "@/components/Logo";

const navLinks = [
  { href: "/pricing", label: "Pricing" },
  { href: "/about",   label: "About" },
  { href: "/faq",     label: "FAQ" },
  { href: "/contact", label: "Contact" },
  { href: "/help",    label: "Help" },
];

const footerLinks = {
  Product: [
    { href: "/pricing", label: "Pricing" },
    { href: "/about",   label: "About" },
    { href: "/faq",     label: "FAQ" },
    { href: "/help",    label: "Help Center" },
    { href: "/trust",   label: "Security" },
    { href: "/contact", label: "Contact Us" },
  ],
  Legal: [
    { href: "/terms",         label: "Terms & Conditions" },
    { href: "/privacy",       label: "Privacy Policy" },
    { href: "/refund-policy", label: "Refund Policy" },
  ],
  Account: [
    { href: "/login",    label: "Sign In" },
    { href: "/register", label: "Create Account" },
  ],
};

const CURRENT_YEAR = new Date().getFullYear();

export function PublicLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden selection:bg-blue-100 dark:selection:bg-blue-900/40 flex flex-col transition-colors duration-200">
      {/* Nav */}
      <header className="fixed top-0 w-full z-50 bg-white/90 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-100 dark:border-slate-700/60">
        <div className="container mx-auto px-5 h-16 flex items-center justify-between max-w-6xl">
          <div className="flex items-center gap-6">
            <Link href="/">
              <div className="flex items-center cursor-pointer">
                <Logo className="h-10 w-auto object-contain max-w-[200px]" />
              </div>
            </Link>
            <nav className="hidden md:flex items-center gap-1">
              {navLinks.map(({ href, label }) => (
                <Link key={href} href={href}>
                  <span className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    location === href
                      ? "text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30"
                      : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800"
                  }`}>
                    {label}
                  </span>
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="flex items-center justify-center h-9 w-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <Button variant="ghost" asChild className="hidden sm:inline-flex text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800 text-sm">
              <Link href="/login">Sign In</Link>
            </Button>
            <Button asChild className="rounded-xl shadow-sm text-sm h-9 px-5">
              <Link href="/register">Get Started</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 pt-16">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
        <div className="container mx-auto px-5 max-w-6xl py-12">
          {/* Top: Brand + links */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
            {/* Brand */}
            <div className="col-span-2 md:col-span-1">
              <Link href="/">
                <div className="mb-3 cursor-pointer">
                  <Logo className="h-8 w-auto object-contain max-w-[140px]" />
                </div>
              </Link>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-[180px]">
                AI-powered email outreach for auto transport brokers.
              </p>
              <div className="flex items-center gap-1.5 mt-3 text-xs text-slate-400 dark:text-slate-600">
                <Truck className="h-3 w-3" />
                <span>Built for auto transport</span>
              </div>
            </div>

            {/* Link columns */}
            {Object.entries(footerLinks).map(([group, links]) => (
              <div key={group}>
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">{group}</p>
                <ul className="space-y-2">
                  {links.map(({ href, label }) => (
                    <li key={href}>
                      <Link href={href}>
                        <span className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer">{label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Bottom bar */}
          <div className="pt-6 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-slate-400 dark:text-slate-600">
              © {CURRENT_YEAR} BrokerMAIL AI. All rights reserved.
            </p>
            <div className="flex items-center gap-4">
              <Link href="/privacy">
                <span className="text-xs text-slate-400 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-400 cursor-pointer transition-colors">Privacy</span>
              </Link>
              <Link href="/terms">
                <span className="text-xs text-slate-400 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-400 cursor-pointer transition-colors">Terms</span>
              </Link>
              <Link href="/refund-policy">
                <span className="text-xs text-slate-400 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-400 cursor-pointer transition-colors">Refunds</span>
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
