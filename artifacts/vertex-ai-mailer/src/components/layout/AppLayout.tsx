import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import {
  LayoutDashboard, FileText, UploadCloud, Mail, Settings, ShieldAlert,
  Menu, X, Server, CreditCard, SendHorizonal, Megaphone, LayoutGrid,
  Search, LogOut, Palette, HelpCircle, ChevronDown,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useState, useRef, useEffect } from "react";
import { NotificationBell } from "@/components/NotificationBell";

const NAV_ITEMS = [
  { href: "/dashboard",         icon: LayoutDashboard, label: "Dashboard",        exact: true  },
  { href: "/templates",         icon: FileText,        label: "Templates",        exact: true  },
  { href: "/templates/gallery", icon: LayoutGrid,      label: "Template Gallery", exact: true  },
  { href: "/leads/import",      icon: UploadCloud,     label: "Upload & Send",    exact: true  },
  { href: "/campaigns",         icon: Megaphone,       label: "Campaigns",        exact: false },
  { href: "/sent-emails",       icon: SendHorizonal,   label: "Sent Emails",      exact: false },
  { href: "/drafts",            icon: Mail,            label: "Gmail Drafts",     exact: false },
  { href: "/mailbox",           icon: Server,          label: "Mailbox",          exact: true  },
  { href: "/plans",             icon: CreditCard,      label: "Plans & Billing",  exact: true  },
];

function NavItem({ href, icon: Icon, label, exact }: {
  href: string; icon: React.ElementType; label: string; exact?: boolean;
}) {
  const [location] = useLocation();
  const isActive = exact ? location === href : location.startsWith(href);
  return (
    <Link href={href}>
      <span className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer select-none",
        isActive
          ? "bg-blue-50 text-blue-700"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      )}>
        <Icon className={cn("h-4 w-4 flex-shrink-0", isActive ? "text-blue-600" : "text-slate-400")} />
        {label}
      </span>
    </Link>
  );
}

/** Global search bar shown in the top header */
function GlobalSearch() {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={cn(
      "relative hidden sm:flex items-center gap-2 h-9 px-3 rounded-xl border text-sm transition-all duration-150",
      focused
        ? "bg-white border-blue-300 ring-2 ring-blue-100 w-64"
        : "bg-slate-50 border-slate-200 w-48 hover:bg-white hover:border-slate-300"
    )}>
      <Search className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
      <input
        ref={inputRef}
        type="text"
        placeholder="Search…"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="flex-1 bg-transparent outline-none text-slate-700 placeholder-slate-400 min-w-0 text-sm"
      />
      {!focused && (
        <kbd className="flex-shrink-0 hidden md:inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 bg-slate-100 rounded border border-slate-200">
          ⌘K
        </kbd>
      )}
    </div>
  );
}

/** User profile dropdown shown in top header */
function UserProfileDropdown({ user, logout }: {
  user: { name: string; email: string; avatarUrl?: string | null; role?: string };
  logout: () => void;
}) {
  const initials = user.name.charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 h-9 px-2 rounded-xl hover:bg-slate-100 transition-colors group focus:outline-none">
          <Avatar className="h-7 w-7 border border-slate-200 flex-shrink-0">
            {user.avatarUrl
              ? <AvatarImage src={user.avatarUrl} alt={user.name} />
              : <AvatarFallback className="bg-gradient-to-br from-blue-400 to-blue-600 text-white text-xs font-semibold">{initials}</AvatarFallback>}
          </Avatar>
          <div className="hidden md:flex flex-col items-start text-left min-w-0">
            <span className="text-sm font-medium text-slate-900 leading-none truncate max-w-[120px]">{user.name}</span>
          </div>
          <ChevronDown className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={6} className="w-56 rounded-xl shadow-xl border-slate-200 p-1">
        <DropdownMenuLabel className="px-3 py-2">
          <p className="text-sm font-semibold text-slate-900 truncate">{user.name}</p>
          <p className="text-xs text-slate-500 truncate mt-0.5">{user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem asChild className="rounded-lg cursor-pointer">
          <Link href="/settings">
            <Settings className="mr-2 h-4 w-4 text-slate-400" /> My Account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="rounded-lg cursor-pointer">
          <Link href="/settings">
            <Palette className="mr-2 h-4 w-4 text-slate-400" /> Branding Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="rounded-lg cursor-pointer">
          <Link href="/mailbox">
            <Server className="mr-2 h-4 w-4 text-slate-400" /> Mailbox Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="rounded-lg cursor-pointer">
          <Link href="/plans">
            <CreditCard className="mr-2 h-4 w-4 text-slate-400" /> Billing
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="rounded-lg cursor-pointer">
          <a href="mailto:support@brokermail.ai">
            <HelpCircle className="mr-2 h-4 w-4 text-slate-400" /> Help Center
          </a>
        </DropdownMenuItem>

        {user.role === "admin" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="rounded-lg cursor-pointer">
              <Link href="/admin/dashboard">
                <ShieldAlert className="mr-2 h-4 w-4 text-slate-400" /> Admin Panel
              </Link>
            </DropdownMenuItem>
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={logout}
          className="rounded-lg cursor-pointer text-red-600 focus:bg-red-50 focus:text-red-700"
        >
          <LogOut className="mr-2 h-4 w-4" /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Left sidebar — navigation only */
function Sidebar({ onClose }: { onClose?: () => void }) {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div className="flex flex-col h-full bg-white border-r border-slate-200 w-60">
      {/* Logo */}
      <div className="h-24 flex items-center px-5 border-b border-slate-100 flex-shrink-0">
        <Link href="/dashboard" className="flex items-center flex-1 min-w-0">
          <img src="/logo-horizontal.png" alt="BrokerMail AI" className="h-16 w-auto object-contain" style={{ maxWidth: "200px" }} />
        </Link>
        {onClose && (
          <button onClick={onClose} className="ml-2 p-1.5 rounded hover:bg-slate-100 text-slate-400 flex-shrink-0">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {NAV_ITEMS.map(item => <NavItem key={item.href} {...item} />)}
        <div className="pt-4 pb-1">
          <div className="h-px bg-slate-100 mb-3" />
          <NavItem href="/settings" icon={Settings} label="Settings" exact />
        </div>
      </nav>

      {/* Bottom: compact workspace indicator */}
      <div className="border-t border-slate-100 px-4 py-3 flex items-center gap-2.5 min-w-0">
        <Avatar className="h-7 w-7 border border-slate-200 flex-shrink-0">
          {user.avatarUrl
            ? <AvatarImage src={user.avatarUrl} alt={user.name} />
            : <AvatarFallback className="bg-gradient-to-br from-blue-400 to-blue-600 text-white text-[11px] font-semibold">
                {user.name.charAt(0).toUpperCase()}
              </AvatarFallback>}
        </Avatar>
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-semibold text-slate-800 truncate">{user.name}</span>
          <span className="text-[11px] text-slate-400 truncate">{user.email}</span>
        </div>
      </div>
    </div>
  );
}

/** Sticky top header spanning the content area */
function TopHeader({ onMobileMenuClick }: { onMobileMenuClick: () => void }) {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <header className="sticky top-0 z-40 h-14 bg-white/95 backdrop-blur-sm border-b border-slate-200 flex items-center px-4 gap-3 flex-shrink-0">
      {/* Mobile: hamburger + logo */}
      <div className="flex items-center gap-3 lg:hidden">
        <button
          onClick={onMobileMenuClick}
          className="p-2 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/dashboard">
          <img src="/logo-horizontal.png" alt="BrokerMail AI" className="h-10 w-auto object-contain" style={{ maxWidth: "160px" }} />
        </Link>
      </div>

      {/* Spacer */}
      <div className="flex-1 min-w-0" />

      {/* Right: Search + Bell + Profile */}
      <div className="flex items-center gap-1.5">
        <GlobalSearch />
        <div className="h-5 w-px bg-slate-200 mx-1 hidden sm:block" />
        <NotificationBell />
        <UserProfileDropdown user={user} logout={logout} />
      </div>
    </header>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!user) return null;

  return (
    <div className="flex min-h-screen w-full bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col flex-shrink-0 sticky top-0 h-screen">
        <Sidebar />
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 h-full shadow-2xl">
            <Sidebar onClose={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      {/* Main content column */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopHeader onMobileMenuClick={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-auto">
          <div className="max-w-6xl mx-auto w-full px-6 py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
