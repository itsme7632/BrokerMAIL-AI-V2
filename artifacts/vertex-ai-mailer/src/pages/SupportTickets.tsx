import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { usePlatformSettings } from "@/hooks/usePlatformSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  TicketCheck, Plus, X, ChevronRight, Clock, CheckCircle2,
  AlertCircle, MessageSquare, Loader2, RefreshCw, Tag, Search,
} from "lucide-react";

interface SupportTicket {
  id: number;
  subject: string;
  category: string;
  priority: string;
  status: string;
  message: string;
  replies: Array<{ id: string; author: string; authorName: string; message: string; createdAt: string }>;
  createdAt: string;
  updatedAt: string;
}

const CATEGORIES = [
  { value: "general",         label: "General Inquiry" },
  { value: "technical",       label: "Technical Issue" },
  { value: "smtp",            label: "SMTP / Mailbox" },
  { value: "billing",         label: "Billing" },
  { value: "subscription",    label: "Subscription" },
  { value: "bug",             label: "Bug Report" },
  { value: "feature_request", label: "Feature Request" },
  { value: "other",           label: "Other" },
];

const PRIORITIES = [
  { value: "low",    label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high",   label: "High" },
];

function statusBadge(status: string) {
  const map: Record<string, { label: string; cls: string }> = {
    open:              { label: "Open",             cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
    in_progress:       { label: "In Progress",      cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
    waiting_for_user:  { label: "Awaiting Reply",   cls: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" },
    resolved:          { label: "Resolved",         cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
    closed:            { label: "Closed",           cls: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400" },
  };
  const s = map[status] ?? { label: status, cls: "bg-slate-100 text-slate-500" };
  return <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${s.cls}`}>{s.label}</span>;
}

function priorityBadge(priority: string) {
  const map: Record<string, string> = {
    low:    "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400",
    medium: "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300",
    high:   "bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-300",
    urgent: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${map[priority] ?? map.medium}`}>
      {priority}
    </span>
  );
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function token() { return localStorage.getItem("auth_token") ?? ""; }

async function fetchTickets(): Promise<SupportTicket[]> {
  const res = await fetch("/api/support/tickets", { headers: { Authorization: `Bearer ${token()}` } });
  if (!res.ok) throw new Error("Failed to load tickets");
  return res.json();
}

export default function SupportTickets() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const platform = usePlatformSettings();

  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  const [form, setForm] = useState({
    subject: "", category: "general", priority: "medium", message: "",
  });

  const { data: tickets = [], isLoading, refetch } = useQuery<SupportTicket[]>({
    queryKey: ["support-tickets"],
    queryFn:  fetchTickets,
  });

  const createMut = useMutation({
    mutationFn: async (body: typeof form) => {
      const res = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Ticket created", description: "We'll get back to you soon." });
      qc.invalidateQueries({ queryKey: ["support-tickets"] });
      setShowForm(false);
      setForm({ subject: "", category: "general", priority: "medium", message: "" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filteredTickets = tickets.filter(t => {
    if (filterStatus !== "all" && t.status !== filterStatus) return false;
    if (search && !t.subject.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <TicketCheck className="h-6 w-6 text-blue-600" /> Support
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">
            Need help? Open a ticket and we'll respond within{" "}
            {platform.supportResponseTime || "1 business day"}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5 rounded-xl h-9">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" onClick={() => setShowForm(true)} className="gap-1.5 rounded-xl h-9 bg-blue-600 hover:bg-blue-700 text-white">
            <Plus className="h-4 w-4" /> New Ticket
          </Button>
        </div>
      </div>

      {/* Contact info banner */}
      {(platform.supportEmail || platform.businessHours) && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/50 rounded-2xl px-4 py-3 flex flex-wrap gap-4 text-sm text-blue-800 dark:text-blue-300">
          {platform.supportEmail && (
            <span>Email: <a href={`mailto:${platform.supportEmail}`} className="font-medium underline underline-offset-2">{platform.supportEmail}</a></span>
          )}
          {platform.businessHours && (
            <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5 flex-shrink-0" /> {platform.businessHours}</span>
          )}
        </div>
      )}

      {/* New ticket form */}
      {showForm && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900 dark:text-slate-100">New Support Ticket</h2>
            <button onClick={() => setShowForm(false)} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2 space-y-1.5">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Subject *</label>
              <Input
                value={form.subject}
                onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                placeholder="Brief description of your issue"
                className="rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Category</label>
              <select
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Priority</label>
              <select
                value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>

            <div className="sm:col-span-2 space-y-1.5">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Message *</label>
              <Textarea
                value={form.message}
                onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                placeholder="Describe your issue in detail. Include any error messages, steps to reproduce, or relevant context."
                rows={5}
                className="rounded-xl resize-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setShowForm(false)} className="rounded-xl h-9">Cancel</Button>
            <Button
              onClick={() => createMut.mutate(form)}
              disabled={createMut.isPending || !form.subject.trim() || !form.message.trim()}
              className="rounded-xl h-9 gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
            >
              {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <TicketCheck className="h-4 w-4" />}
              Submit Ticket
            </Button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search tickets…"
            className="pl-9 h-9 rounded-xl text-sm"
          />
        </div>
        {["all", "open", "in_progress", "waiting_for_user", "resolved", "closed"].map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium capitalize transition-colors ${
              filterStatus === s
                ? "bg-blue-600 text-white shadow-sm"
                : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50"
            }`}
          >
            {s === "in_progress" ? "In Progress" : s === "waiting_for_user" ? "Awaiting Reply" : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Tickets list */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 h-20 animate-pulse" />
          ))}
        </div>
      ) : filteredTickets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-14 w-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
            <TicketCheck className="h-7 w-7 text-slate-400" />
          </div>
          <p className="font-semibold text-slate-800 dark:text-slate-200 mb-1">
            {tickets.length === 0 ? "No support tickets yet" : "No tickets match your filter"}
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            {tickets.length === 0
              ? "Need help? Open a ticket and we'll get back to you."
              : "Try adjusting your search or filter."}
          </p>
          {tickets.length === 0 && (
            <Button onClick={() => setShowForm(true)} className="gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white">
              <Plus className="h-4 w-4" /> Open First Ticket
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredTickets.map(ticket => (
            <Link key={ticket.id} href={`/support/${ticket.id}`} className="block">
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-blue-200 dark:hover:border-blue-700 rounded-2xl p-4 cursor-pointer transition-all hover:shadow-sm group">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">#{ticket.id}</span>
                      {statusBadge(ticket.status)}
                      {priorityBadge(ticket.priority)}
                      <span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 capitalize">
                        <Tag className="h-3 w-3 inline mr-0.5" />
                        {CATEGORIES.find(c => c.value === ticket.category)?.label ?? ticket.category}
                      </span>
                    </div>
                    <p className="font-semibold text-slate-900 dark:text-slate-100 truncate group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors">
                      {ticket.subject}
                    </p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 flex items-center gap-2">
                      <Clock className="h-3 w-3" />
                      {relativeTime(ticket.createdAt)}
                      {ticket.replies?.length > 0 && (
                        <span className="flex items-center gap-1">
                          <MessageSquare className="h-3 w-3" />
                          {ticket.replies.length} {ticket.replies.length === 1 ? "reply" : "replies"}
                        </span>
                      )}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300 dark:text-slate-600 group-hover:text-blue-500 flex-shrink-0 mt-1 transition-colors" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
