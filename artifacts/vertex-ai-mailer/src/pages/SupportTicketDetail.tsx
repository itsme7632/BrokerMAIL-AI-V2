import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  TicketCheck, ArrowLeft, Loader2, CheckCircle2, AlertCircle,
  MessageSquare, User, Shield, Clock, Send, XCircle, Tag,
} from "lucide-react";

interface Reply {
  id: string; author: string; authorName: string; message: string; createdAt: string;
}

interface SupportTicket {
  id: number; subject: string; category: string; priority: string;
  status: string; message: string; adminNote?: string;
  replies: Reply[]; createdAt: string; updatedAt: string;
}

const CATEGORIES: Record<string, string> = {
  general:         "General Inquiry",
  technical:       "Technical Issue",
  smtp:            "SMTP / Mailbox",
  billing:         "Billing",
  subscription:    "Subscription",
  bug:             "Bug Report",
  feature_request: "Feature Request",
  other:           "Other",
};

function statusBadge(status: string) {
  const map: Record<string, { label: string; icon: React.ElementType; cls: string }> = {
    open:             { label: "Open",           icon: AlertCircle, cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
    in_progress:      { label: "In Progress",    icon: Loader2,     cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
    waiting_for_user: { label: "Awaiting Reply", icon: MessageSquare, cls: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" },
    resolved:         { label: "Resolved",       icon: CheckCircle2, cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
    closed:           { label: "Closed",         icon: XCircle,     cls: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400" },
  };
  const s = map[status] ?? { label: status, icon: AlertCircle, cls: "bg-slate-100 text-slate-500" };
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${s.cls}`}>
      <Icon className="h-3 w-3" /> {s.label}
    </span>
  );
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function token() { return localStorage.getItem("auth_token") ?? ""; }

async function fetchTicket(id: string): Promise<SupportTicket> {
  const res = await fetch(`/api/support/tickets/${id}`, { headers: { Authorization: `Bearer ${token()}` } });
  if (!res.ok) throw new Error("Ticket not found");
  return res.json();
}

export default function SupportTicketDetail() {
  const [, params] = useRoute("/support/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const ticketId = params?.id ?? "";

  const [replyText, setReplyText] = useState("");
  const [closing, setClosing] = useState(false);

  const { data: ticket, isLoading, error } = useQuery<SupportTicket>({
    queryKey: ["support-ticket", ticketId],
    queryFn:  () => fetchTicket(ticketId),
    enabled:  !!ticketId,
  });

  const replyMut = useMutation({
    mutationFn: async (message: string) => {
      const res = await fetch(`/api/support/tickets/${ticketId}/reply`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      setReplyText("");
      qc.invalidateQueries({ queryKey: ["support-ticket", ticketId] });
      qc.invalidateQueries({ queryKey: ["support-tickets"] });
      toast({ title: "Reply sent" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  async function closeTicket() {
    if (!confirm("Mark this ticket as closed?")) return;
    setClosing(true);
    try {
      const res = await fetch(`/api/support/tickets/${ticketId}/close`, {
        method: "POST", headers: { Authorization: `Bearer ${token()}` },
      });
      if (!res.ok) throw new Error("Failed to close ticket");
      qc.invalidateQueries({ queryKey: ["support-ticket", ticketId] });
      qc.invalidateQueries({ queryKey: ["support-tickets"] });
      toast({ title: "Ticket closed" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setClosing(false); }
  }

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="max-w-3xl mx-auto text-center py-20">
        <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
        <p className="font-semibold text-slate-800 dark:text-slate-200">Ticket not found</p>
        <Button variant="outline" onClick={() => navigate("/support")} className="mt-4 gap-2 rounded-xl">
          <ArrowLeft className="h-4 w-4" /> Back to Support
        </Button>
      </div>
    );
  }

  const isClosed = ticket.status === "closed";
  const allMessages = [
    { id: "orig", author: "user", authorName: "You (original)", message: ticket.message, createdAt: ticket.createdAt },
    ...(ticket.replies ?? []),
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Back */}
      <button
        onClick={() => navigate("/support")}
        className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to tickets
      </button>

      {/* Ticket header */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
        <div className="flex flex-wrap items-start gap-2 justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">Ticket #{ticket.id}</span>
              {statusBadge(ticket.status)}
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                ticket.priority === "high" ? "bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-300"
                : ticket.priority === "urgent" ? "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300"
                : ticket.priority === "low" ? "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                : "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300"
              }`}>{ticket.priority}</span>
            </div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">{ticket.subject}</h1>
          </div>
          {!isClosed && (
            <Button
              variant="outline" size="sm"
              onClick={closeTicket} disabled={closing}
              className="rounded-xl h-8 text-xs border-slate-200 hover:border-slate-300 text-slate-500 gap-1.5 flex-shrink-0"
            >
              {closing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
              Close Ticket
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-3 text-xs text-slate-400 dark:text-slate-500">
          <span className="flex items-center gap-1">
            <Tag className="h-3 w-3" />
            {CATEGORIES[ticket.category] ?? ticket.category}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" /> Opened {formatTime(ticket.createdAt)}
          </span>
          {ticket.updatedAt !== ticket.createdAt && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" /> Updated {formatTime(ticket.updatedAt)}
            </span>
          )}
        </div>

        {ticket.adminNote && (
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 text-sm text-amber-800 dark:text-amber-300">
            <p className="font-semibold text-xs mb-1">Admin Note</p>
            {ticket.adminNote}
          </div>
        )}
      </div>

      {/* Message thread */}
      <div className="space-y-3">
        {allMessages.map((msg) => {
          const isAdmin = msg.author === "admin";
          return (
            <div key={msg.id} className={`flex gap-3 ${isAdmin ? "flex-row-reverse" : ""}`}>
              <div className={`h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                isAdmin
                  ? "bg-blue-600 text-white"
                  : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
              }`}>
                {isAdmin ? <Shield className="h-4 w-4" /> : <User className="h-4 w-4" />}
              </div>
              <div className={`flex-1 min-w-0 ${isAdmin ? "items-end" : ""}`}>
                <div className={`rounded-2xl px-4 py-3 ${
                  isAdmin
                    ? "bg-blue-600 text-white ml-6"
                    : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 mr-6"
                }`}>
                  <div className={`flex items-center gap-2 mb-1 ${isAdmin ? "flex-row-reverse" : ""}`}>
                    <p className={`text-xs font-semibold ${isAdmin ? "text-blue-100" : "text-slate-700 dark:text-slate-300"}`}>
                      {isAdmin ? "Support Team" : "You"}
                    </p>
                    {msg.id === "orig" && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 font-medium">
                        Original
                      </span>
                    )}
                  </div>
                  <p className={`text-sm whitespace-pre-wrap leading-relaxed ${
                    isAdmin ? "text-white" : "text-slate-800 dark:text-slate-200"
                  }`}>
                    {msg.message}
                  </p>
                </div>
                <p className={`text-[11px] text-slate-400 dark:text-slate-500 mt-1 px-1 ${isAdmin ? "text-right" : ""}`}>
                  {formatTime(msg.createdAt)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Reply form */}
      {!isClosed ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 space-y-3">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-blue-600" /> Add Reply
          </p>
          <Textarea
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            placeholder="Type your reply here…"
            rows={4}
            className="rounded-xl resize-none"
          />
          <div className="flex justify-end">
            <Button
              onClick={() => replyMut.mutate(replyText)}
              disabled={replyMut.isPending || !replyText.trim()}
              className="gap-1.5 rounded-xl h-9 bg-blue-600 hover:bg-blue-700 text-white"
            >
              {replyMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send Reply
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl">
          <XCircle className="h-5 w-5 text-slate-400 flex-shrink-0" />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            This ticket is closed. <button
              onClick={() => navigate("/support")}
              className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
            >Open a new ticket</button> if you need further assistance.
          </p>
        </div>
      )}
    </div>
  );
}
