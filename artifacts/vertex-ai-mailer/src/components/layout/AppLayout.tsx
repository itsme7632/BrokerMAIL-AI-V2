import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { Logo } from "@/components/Logo";
import {
  LayoutDashboard, FileText, UploadCloud, Mail, Settings, ShieldAlert,
  Menu, X, Server, CreditCard, SendHorizonal, Megaphone, LayoutGrid,
  LogOut, Palette, HelpCircle, ChevronDown, Moon, Sun, PenLine,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { NotificationBell } from "@/components/NotificationBell";

const NAV_ITEMS = [
  { href: "/dashboard",         icon: LayoutDashboard, label: "Dashboard",        exact: true  },
  { href: "/templates",         icon: FileText,        label: "Templates",        exact: true  },
  { href: "/templates/gallery", icon: LayoutGrid,      label: "Template Gallery", exact: true  },
  { href: "/compose",           icon: PenLine,         label: "Compose Email",    exact: true  },
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
    <Link href={href} className="block">
      <span className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer select-none",
        isActive
          ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700/60 dark:hover:text-slate-100"
      )}>
        <Icon className={cn("h-4 w-4 flex-shrink-0", isActive ? "text-blue-600 dark:text-blue-400" : "text-slate-400 dark:text-slate-500")} />
        {label}
      </span>
    </Link>
  );
}

/** Moon/Sun toggle button */
function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className="flex items-center justify-center h-9 w-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
    >
      {theme === "dark"
        ? <Sun className="h-4 w-4" />
        : <Moon className="h-4 w-4" />}
    </button>
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
          <a href="mailto:support@brokermail.ai">
            <HelpCircle className="mr-2 h-4 w-4 text-muted-foreground" /> Help Center
          </a>
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

/** Left sidebar — navigation only */
function Sidebar({ onClose }: { onClose?: () => void }) {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700/60 w-60">
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

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {NAV_ITEMS.map(item => <NavItem key={item.href} {...item} />)}
        <div className="pt-4 pb-1">
          <div className="h-px bg-slate-100 dark:bg-slate-700/60 mb-3" />
          <NavItem href="/settings" icon={Settings} label="Settings" exact />
        </div>
      </nav>

      {/* Bottom: compact workspace indicator */}
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
  );
}

/** Sticky top header spanning the content area */
function TopHeader({ onMobileMenuClick }: { onMobileMenuClick: () => void }) {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <header className="sticky top-0 z-40 h-14 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700/60 flex items-center px-4 gap-3 flex-shrink-0">
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
        <main className="flex-1 overflow-auto">
          <div className="max-w-6xl mx-auto w-full px-6 py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
