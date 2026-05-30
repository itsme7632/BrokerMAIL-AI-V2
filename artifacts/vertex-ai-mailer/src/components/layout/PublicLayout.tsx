import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";

const navLinks = [
  { href: "/pricing", label: "Pricing" },
  { href: "/faq",     label: "FAQ" },
  { href: "/contact", label: "Contact" },
  { href: "/trust",   label: "Security" },
];

export function PublicLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="min-h-screen bg-white text-slate-900 overflow-hidden selection:bg-blue-100 flex flex-col">
      {/* Nav */}
      <header className="fixed top-0 w-full z-50 bg-white/90 backdrop-blur-md border-b border-slate-100">
        <div className="container mx-auto px-5 h-16 flex items-center justify-between max-w-6xl">
          <div className="flex items-center gap-6">
            <Link href="/">
              <div className="flex items-center cursor-pointer">
                <img
                  src="/logo-horizontal.png"
                  alt="BrokerMail AI"
                  className="h-10 w-auto object-contain"
                  style={{ maxWidth: "180px" }}
                />
              </div>
            </Link>
            <nav className="hidden md:flex items-center gap-1">
              {navLinks.map(({ href, label }) => (
                <Link key={href} href={href}>
                  <span className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    location === href
                      ? "text-blue-700 bg-blue-50"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                  }`}>
                    {label}
                  </span>
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" asChild className="hidden sm:inline-flex text-slate-600 hover:text-slate-900 text-sm">
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
      <footer className="py-10 border-t border-slate-100 bg-white">
        <div className="container mx-auto px-5 max-w-6xl">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center">
              <img
                src="/logo-horizontal.png"
                alt="BrokerMail AI"
                className="h-8 w-auto object-contain"
                style={{ maxWidth: "140px" }}
              />
            </div>
            <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
              {navLinks.map(({ href, label }) => (
                <Link key={href} href={href}>
                  <span className="text-xs text-slate-500 hover:text-slate-800 transition-colors cursor-pointer">{label}</span>
                </Link>
              ))}
              <Link href="/login">
                <span className="text-xs text-slate-500 hover:text-slate-800 transition-colors cursor-pointer">Sign In</span>
              </Link>
              <Link href="/register">
                <span className="text-xs text-slate-500 hover:text-slate-800 transition-colors cursor-pointer">Register</span>
              </Link>
            </nav>
            <p className="text-xs text-slate-400">Built for the auto transport industry.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
