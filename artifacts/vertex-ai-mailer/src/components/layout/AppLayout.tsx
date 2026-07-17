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

function getPlanStyle(planName: string) {
  const n = planName.toLowerCase();
  if (n.includes("enterprise"))
    return { cls: "bg-amber-500/15 border-amber-500/30 text-amber-400", dot: "bg-amber-400" };
  if (n.includes("growth") || n.includes("pro"))
    return { cls: "bg-purple-500/15 border-purple-500/30 text-purple-400", dot: "bg-purple-400" };
  if (n.includes("starter"))
    return { cls: "bg-blue-500/15 border-blue-500/30 text-blue-400", dot: "bg-blue-400" };
  return { cls: "bg-slate-500/15 border-slate-500/30 text-slate-400", dot: "bg-slate-400" };
}

function UserProfileDropdown({ user, logout }: {
  user: { name: string; email: string; avatarUrl?: string | null; role?: string; emailVerified?: boolean };
  logout: () => void;
}) {
  const [planName, setPlanName] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("auth_token") ?? "";
    if (!token) return;
    fetch("/api/billing/subscription", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => d?.plan?.name && setPlanName(d.plan.name))
      .catch(() => {});
  }, []);

  const initials = user.name
    .split(" ")
    .map(w => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const plan = planName ? getPlanStyle(planName) : null;

  const navItems = [
    { href: "/profile",       icon: Zap,        label: "My Profile",      desc: "Account & security" },
    { href: "/settings",      icon: Palette,    label: "Brand Settings",  desc: "Logo, colors & signature" },
    { href: "/mailbox",       icon: Server,     label: "Mailboxes",       desc: "SMTP accounts" },
    { href: "/plans",         icon: CreditCard, label: "Billing & Plans", desc: "Subscription & usage" },
    { href: "/notifications", icon: Bell,       label: "Notifications",   desc: "Activity feed" },
    { href: "/support",       icon: HelpCircle, label: "Help & Support",  desc: "Get assistance" },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 h-9 px-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700/70 transition-all duration-200 group focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50">
          <Avatar className="h-7 w-7 border border-slate-200 dark:border-slate-600 flex-shrink-0 shadow-sm">
            {user.avatarUrl
              ? <AvatarImage src={user.avatarUrl} alt={user.name} />
              : <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-xs font-bold">{initials}</AvatarFallback>}
          </Avatar>
          <div className="hidden md:flex flex-col items-start text-left min-w-0">
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-none truncate max-w-[110px]">{user.name}</span>
          </div>
          <ChevronDown className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 flex-shrink-0 group-data-[state=open]:rotate-180 transition-transform duration-200" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-72 rounded-2xl shadow-2xl p-0 overflow-hidden border border-border/80 dark:border-slate-700/60 bg-card dark:bg-slate-900"
      >
        {/* ── Account card ── */}
        <div className="relative px-4 py-4 bg-gradient-to-br from-blue-600/8 via-indigo-500/5 to-transparent border-b border-border/60 dark:border-slate-700/60">
          <div className="flex items-center gap-3">
            {/* Large avatar */}
            <Avatar className="h-12 w-12 border-2 border-white/20 dark:border-slate-600/60 shadow-lg flex-shrink-0">
              {user.avatarUrl
                ? <AvatarImage src={user.avatarUrl} alt={user.name} />
                : <AvatarFallback className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-base font-bold">{initials}</AvatarFallback>}
            </Avatar>

            {/* Identity */}
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-foreground dark:text-slate-100 truncate leading-tight">{user.name}</p>
              <p className="text-xs text-muted-foreground dark:text-slate-400 truncate mt-0.5">{user.email}</p>
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {plan && planName && (
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${plan.cls}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${plan.dot}`} />
                    {planName} Plan
                  </span>
                )}
                {user.emailVerified && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 border border-blue-500/20 text-blue-400">
                    ✓ Verified
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Nav items ── */}
        <div className="p-1.5 space-y-0.5">
          {navItems.map(item => (
            <DropdownMenuItem key={item.href} asChild className="rounded-xl cursor-pointer p-0 focus:bg-transparent">
              <Link
                href={item.href}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-secondary dark:hover:bg-slate-800/60 transition-all duration-150 group/item w-full"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-secondary dark:bg-slate-800/80 border border-border dark:border-slate-700/60 flex-shrink-0 group-hover/item:border-blue-500/30 transition-colors">
                  <item.icon className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400 group-hover/item:text-blue-500 dark:group-hover/item:text-blue-400 transition-colors" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground dark:text-slate-200 leading-none">{item.label}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{item.desc}</p>
                </div>
              </Link>
            </DropdownMenuItem>
          ))}
        </div>

        {/* ── Admin section ── */}
        {user.role === "admin" && (
          <>
            <DropdownMenuSeparator className="my-0 bg-border dark:bg-slate-800" />
            <div className="px-1.5 pt-1 pb-1.5">
              <p className="px-3 pt-1 pb-1 text-[9px] font-semibold text-slate-400 uppercase tracking-widest">Administration</p>
              <DropdownMenuItem asChild className="rounded-xl cursor-pointer p-0 focus:bg-transparent">
                <Link
                  href="/admin/dashboard"
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-secondary dark:hover:bg-slate-800/60 transition-all duration-150 group/item w-full"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10 border border-amber-500/20 flex-shrink-0">
                    <ShieldAlert className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground dark:text-slate-200 leading-none">Admin Dashboard</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">Platform management</p>
                  </div>
                </Link>
              </DropdownMenuItem>
            </div>
          </>
        )}

        {/* ── Sign out ── */}
        <DropdownMenuSeparator className="my-0 bg-border dark:bg-slate-800" />
        <div className="p-1.5">
          <DropdownMenuItem
            onClick={logout}
            className="rounded-xl cursor-pointer px-3 py-2.5 text-red-500 dark:text-red-400 focus:bg-red-50 dark:focus:bg-red-950/40 focus:text-red-600 dark:focus:text-red-400 transition-colors"
          >
            <LogOut className="mr-3 h-3.5 w-3.5 flex-shrink-0" />
            <span className="text-sm font-medium">Sign Out</span>
          </DropdownMenuItem>
        </div>
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
      {/* Logo — pinned, never scrolls */}
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

      {/* ── Dashboard link (standalone, no section header) — pinned, never scrolls */}
      <div className="px-3 pt-3 pb-1 flex-shrink-0">
        <NavItem href="/dashboard" icon={LayoutDashboard} label="Dashboard" exact />
      </div>

      {/* ── Grouped nav — scrolls independently, scrollbar hidden on all browsers */}
      <nav className="flex-1 overflow-y-auto no-scrollbar px-0 py-2 space-y-4">
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

      {/* ── Bottom: plan card + need help — pinned, never scrolls */}
      <div className="pt-2 pb-1 border-t border-slate-100 dark:border-slate-700/60 flex-shrink-0">
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
  const [location] = useLocation();
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
          {/* Admin routes get full-width layout; all other pages stay centered */}
          <div className={location.startsWith("/admin") ? "w-full px-5 py-5 min-w-0" : "max-w-6xl mx-auto w-full px-6 py-8"}>
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
