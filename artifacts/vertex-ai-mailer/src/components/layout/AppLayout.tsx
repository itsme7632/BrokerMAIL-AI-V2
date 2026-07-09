import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { Logo } from "@/components/Logo";
import {
  LayoutDashboard, FileText, UploadCloud, Mail, Settings, ShieldAlert,
  Menu, X, Server, CreditCard, SendHorizonal, Megaphone, LayoutGrid,
  LogOut, Palette, HelpCircle, ChevronDown, Moon, Sun, PenLine, TicketCheck,
  Zap, Sparkles, Map, MessageSquare, Bug, Lightbulb, Bell,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import { NotificationBell } from "@/components/NotificationBell";
import { HeaderBanner } from "@/components/product-hub/HeaderBanner";
import { VersionPopup } from "@/components/product-hub/VersionPopup";
import { SuggestFeatureButton } from "@/components/product-hub/SuggestFeatureButton";

// ─── Nav groups ───────────────────────────────────────────────────────────────

const NAV_GROUPS = [
  {
    label: "COMMUNICATION",
    items: [
      { href: "/compose",           icon: PenLine,      label: "Compose Email",    exact: true  },
      { href: "/templates",         icon: FileText,     label: "Templates",        exact: true  },
      { href: "/templates/gallery", icon: LayoutGrid,   label: "Template Gallery", exact: true  },
      { href: "/leads/import",      icon: UploadCloud,  label: "Upload & Send",    exact: true  },
    ],
  },
  {
    label: "CAMPAIGNS",
    items: [
      { href: "/campaigns",         icon: Megaphone,    label: "Campaigns",        exact: false },
      { href: "/sent-emails",       icon: SendHorizonal,label: "Sent Emails",      exact: false },
      { href: "/drafts",            icon: Mail,         label: "Gmail Drafts",     exact: false },
    ],
  },
  {
    label: "ACCOUNT",
    items: [
      { href: "/mailbox",           icon: Server,       label: "Mailbox",          exact: true  },
      { href: "/plans",             icon: CreditCard,   label: "Plans & Billing",  exact: true  },
      { href: "/suppressions",      icon: ShieldAlert,  label: "Suppression List", exact: true  },
      { href: "/settings",          icon: Settings,     label: "Settings",         exact: true  },
      { href: "/support",           icon: TicketCheck,  label: "Support",          exact: false },
    ],
  },
  {
    label: "PRODUCT HUB",
    items: [
      { href: "/whats-new",            icon: Sparkles,      label: "What's New",    exact: true  },
      { href: "/roadmap",              icon: Map,           label: "Roadmap",       exact: true  },
      { href: "/product-hub/feedback", icon: MessageSquare, label: "Feedback",      exact: true  },
      { href: "/report-bug",           icon: Bug,           label: "Report a Bug",  exact: true  },
      { href: "/notifications",        icon: Bell,          label: "Notifications", exact: true  },
    ],
  },
];

// ─── Nav item ─────────────────────────────────────────────────────────────────

function NavItem({ href, icon: Icon, label, exact, badge }: {
  href: string; icon: React.ElementType; label: string; exact?: boolean; badge?: number;
}) {
  const [location] = useLocation();
  const isActive = exact ? location === href : location.startsWith(href);
  return (
    <Link href={href} className="block relative">
      {isActive && (
        <span
          aria-hidden="true"
          className="absolute inset-y-1 -left-3 w-[3px] rounded-r-full bg-blue-600 dark:bg-blue-500"
        />
      )}
      <span className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer select-none",
        isActive
          ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700/60 dark:hover:text-slate-100"
      )}>
        <Icon className={cn("h-4 w-4 flex-shrink-0 transition-colors", isActive ? "text-blue-600 dark:text-blue-400" : "text-slate-400 dark:text-slate-500")} />
        <span className="flex-1 truncate">{label}</span>
        {badge && badge > 0 ? (
          <span className="flex-shrink-0 h-4 min-w-4 px-1 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

// ─── Theme toggle ─────────────────────────────────────────────────────────────

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className="flex items-center justify-center h-9 w-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-all duration-200 shadow-sm"
    >
      {theme === "dark"
        ? <Sun className="h-4 w-4" />
        : <Moon className="h-4 w-4" />}
    </button>
  );
}

// ─── User profile dropdown ────────────────────────────────────────────────────

function UserProfileDropdown({ user, logout }: {
  user: { name: string; email: string; avatarUrl?: string | null; role?: string };
  logout: () => void;
}) {
  const initials = user.name.charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 h-9 px-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors group focus:outline-none">
          <Avatar className="h-7 w-7 border border-slate-200 dark:border-slate-600 flex-shrink-0">
            {user.avatarUrl
              ? <AvatarImage src={user.avatarUrl} alt={user.name} />
              : <AvatarFallback className="bg-gradient-to-br from-blue-400 to-blue-600 text-white text-xs font-semibold">{initials}</AvatarFallback>}
          </Avatar>
          <div className="hidden md:flex flex-col items-start text-left min-w-0">
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100 leading-none truncate max-w-[120px]">{user.name}</span>
          </div>
          <ChevronDown className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 flex-shrink-0" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={6} className="w-56 rounded-xl shadow-xl p-1">
        <DropdownMenuLabel className="px-3 py-2">
          <p className="text-sm font-semibold truncate">{user.name}</p>
          <p className="text-xs text-muted-foreground truncate mt-0.5">{user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem asChild className="rounded-lg cursor-pointer">
          <Link href="/settings">
            <Settings className="mr-2 h-4 w-4 text-muted-foreground" /> My Account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="rounded-lg cursor-pointer">
          <Link href="/settings">
            <Palette className="mr-2 h-4 w-4 text-muted-foreground" /> Branding Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="rounded-lg cursor-pointer">
          <Link href="/mailbox">
            <Server className="mr-2 h-4 w-4 text-muted-foreground" /> Mailbox Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="rounded-lg cursor-pointer">
          <Link href="/plans">
            <CreditCard className="mr-2 h-4 w-4 text-muted-foreground" /> Billing
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="rounded-lg cursor-pointer">
          <Link href="/support">
            <HelpCircle className="mr-2 h-4 w-4 text-muted-foreground" /> Support
          </Link>
        </DropdownMenuItem>

        {user.role === "admin" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="rounded-lg cursor-pointer">
              <Link href="/admin/dashboard">
                <ShieldAlert className="mr-2 h-4 w-4 text-muted-foreground" /> Admin Panel
              </Link>
            </DropdownMenuItem>
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={logout}
          className="rounded-lg cursor-pointer text-red-600 focus:bg-red-50 dark:focus:bg-red-950/40 focus:text-red-700 dark:focus:text-red-400"
        >
          <LogOut className="mr-2 h-4 w-4" /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Sidebar plan card ────────────────────────────────────────────────────────

function SidebarPlanCard() {
  const [billing, setBilling] = useState<{
    plan:  { name: string; monthlyEmailLimit: number };
    usage: { emailsSentThisMonth: number };
  } | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("auth_token") ?? "";
    fetch("/api/billing/subscription", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setBilling(d))
      .catch(() => {});
  }, []);

  const pct = billing?.plan.monthlyEmailLimit && billing.plan.monthlyEmailLimit > 0
    ? Math.min(100, Math.round((billing.usage.emailsSentThisMonth / billing.plan.monthlyEmailLimit) * 100))
    : 0;

  return (
    <div className="mx-3 mb-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-blue-50/60 dark:bg-slate-800/60 p-3.5">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-1.5">
          <Zap className="h-3 w-3 text-blue-500 dark:text-blue-400 flex-shrink-0" />
          <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
            {billing ? billing.plan.name : <span className="text-slate-400 dark:text-slate-500">—</span>}
          </span>
        </div>
        <Link href="/plans">
          <span className="text-[10px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors cursor-pointer">
            Manage
          </span>
        </Link>
      </div>

      {billing ? (
        <>
          <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 mb-1.5">
            <span>{billing.usage.emailsSentThisMonth.toLocaleString()} used</span>
            <span>
              {billing.plan.monthlyEmailLimit === -1 ? "Unlimited" : `${billing.plan.monthlyEmailLimit.toLocaleString()} limit`}
            </span>
          </div>
          <div className="h-1 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${pct}%`,
                backgroundColor: pct >= 90 ? "#f87171" : pct >= 70 ? "#fb923c" : "#3b82f6",
              }}
            />
          </div>
        </>
      ) : (
        <div className="space-y-1.5">
          <Skeleton className="h-2 w-full bg-slate-200 dark:bg-slate-700" />
          <Skeleton className="h-1 w-full bg-slate-200 dark:bg-slate-700" />
        </div>
      )}
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ onClose }: { onClose?: () => void }) {
  const { user } = useAuth();
  const [whatsNewUnread, setWhatsNewUnread] = useState(0);

  useEffect(() => {
    const t = localStorage.getItem("auth_token") ?? "";
    if (!t) return;
    fetch("/api/product-hub/releases/unread-count", { headers: { Authorization: `Bearer ${t}` } })
      .then(r => r.ok ? r.json() : { count: 0 })
      .then(d => setWhatsNewUnread(d.unreadCount ?? 0))
      .catch(() => {});
  }, []);

  if (!user) return null;

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 border-r border-slate-200/80 dark:border-slate-700/60 w-60">
      {/* Logo */}
      <div className="h-24 flex items-center px-5 border-b border-slate-100 dark:border-slate-700/60 flex-shrink-0">
        <Link href="/dashboard" className="flex items-center flex-1 min-w-0">
          <Logo className="h-10 w-auto object-contain max-w-[190px]" />
        </Link>
        {onClose && (
          <button onClick={onClose} className="ml-2 p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 dark:text-slate-500 flex-shrink-0">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* ── Dashboard link (standalone, no section header) */}
      <div className="px-3 pt-3 pb-1">
        <NavItem href="/dashboard" icon={LayoutDashboard} label="Dashboard" exact />
      </div>

      {/* ── Grouped nav ── */}
      <nav className="flex-1 overflow-y-auto px-0 py-2 space-y-4">
        {NAV_GROUPS.map(group => (
          <div key={group.label}>
            <p className="px-4 pb-1 text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
              {group.label}
            </p>
            <div className="px-3 space-y-0.5">
              {group.items.map(item => (
                <NavItem
                  key={item.href}
                  {...item}
                  badge={item.href === "/whats-new" ? (whatsNewUnread || undefined) : undefined}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* ── Bottom: plan card + need help ── */}
      <div className="pt-2 pb-1 border-t border-slate-100 dark:border-slate-700/60">
        <SidebarPlanCard />

        {/* Need Help */}
        <div className="mx-3 mb-2">
          <Link href="/support">
            <div className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors cursor-pointer group">
              <HelpCircle className="h-4 w-4 text-slate-400 dark:text-slate-500 flex-shrink-0 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 leading-tight">Need Help?</p>
                <p className="text-[10px] text-slate-400 dark:text-slate-500">Contact Support</p>
              </div>
            </div>
          </Link>
        </div>

        {/* User badge */}
        <div className="border-t border-slate-100 dark:border-slate-700/60 px-4 py-3 flex items-center gap-2.5 min-w-0">
          <Avatar className="h-7 w-7 border border-slate-200 dark:border-slate-600 flex-shrink-0">
            {user.avatarUrl
              ? <AvatarImage src={user.avatarUrl} alt={user.name} />
              : <AvatarFallback className="bg-gradient-to-br from-blue-400 to-blue-600 text-white text-[11px] font-semibold">
                  {user.name.charAt(0).toUpperCase()}
                </AvatarFallback>}
          </Avatar>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{user.name}</span>
            <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{user.email}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Top header ───────────────────────────────────────────────────────────────

function TopHeader({ onMobileMenuClick }: { onMobileMenuClick: () => void }) {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <header className="sticky top-0 z-40 h-14 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-200/80 dark:border-slate-700/60 flex items-center px-4 gap-3 flex-shrink-0">
      {/* Mobile: hamburger + logo */}
      <div className="flex items-center gap-3 lg:hidden">
        <button
          onClick={onMobileMenuClick}
          className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 transition-colors"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/dashboard">
          <Logo className="h-9 w-auto object-contain max-w-[150px]" />
        </Link>
      </div>

      {/* Spacer */}
      <div className="flex-1 min-w-0" />

      {/* Right: Theme toggle + Bell + Profile */}
      <div className="flex items-center gap-1.5">
        <ThemeToggle />
        <NotificationBell />
        <UserProfileDropdown user={user} logout={logout} />
      </div>
    </header>
  );
}

// ─── AppLayout ────────────────────────────────────────────────────────────────

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!user) return null;

  return (
    <div className="flex min-h-screen w-full bg-slate-50 dark:bg-slate-950">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col flex-shrink-0 sticky top-0 h-screen">
        <Sidebar />
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/30 dark:bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 h-full shadow-2xl">
            <Sidebar onClose={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      {/* Main content column */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopHeader onMobileMenuClick={() => setMobileOpen(true)} />
        <HeaderBanner />
        <main className="flex-1 overflow-auto">
          <div className="max-w-6xl mx-auto w-full px-6 py-8">
            {children}
          </div>
        </main>
      </div>

      {/* Global product-hub overlays (rendered once at root level) */}
      <VersionPopup />
      <SuggestFeatureButton />
    </div>
  );
}
