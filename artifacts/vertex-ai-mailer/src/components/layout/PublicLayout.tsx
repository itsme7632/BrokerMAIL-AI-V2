import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/context/ThemeContext";
import { Moon, Sun } from "lucide-react";
import { Logo } from "@/components/Logo";

const navLinks = [
  { href: "/pricing", label: "Pricing" },
  { href: "/faq",     label: "FAQ" },
  { href: "/contact", label: "Contact" },
  { href: "/trust",   label: "Security" },
];

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
      <footer className="py-10 border-t border-slate-100 dark:border-slate-700/60 bg-white dark:bg-slate-900">
        <div className="container mx-auto px-5 max-w-6xl">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center">
              <Logo className="h-8 w-auto object-contain max-w-[160px]" />
            </div>
            <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
              {navLinks.map(({ href, label }) => (
                <Link key={href} href={href}>
                  <span className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer">{label}</span>
                </Link>
              ))}
              <Link href="/login">
                <span className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer">Sign In</span>
              </Link>
              <Link href="/register">
                <span className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer">Register</span>
              </Link>
            </nav>
            <p className="text-xs text-slate-400 dark:text-slate-500">Built for the auto transport industry.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
