/**
 * AdminProductHub.tsx
 * Admin management panel for the full Product Hub.
 * Rendered as a tab inside Admin.tsx.
 */
import { useState, useEffect, useCallback } from "react";
import {
  Sparkles, Map, MessageSquare, Bug, Lightbulb, Megaphone,
  Plus, Pencil, Trash2, RefreshCw, X, CheckCircle2, AlertCircle,
  ChevronRight, Send, Eye, Loader2, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function token() { return localStorage.getItem("auth_token") ?? ""; }

async function hubFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`/api/product-hub/${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? `Error ${res.status}`); }
  return res.json();
}

type SubTab = "releases" | "roadmap" | "announcements" | "feedback" | "bugs" | "features";

const SUB_TABS: { id: SubTab; label: string; icon: React.ElementType }[] = [
  { id: "releases",      label: "What's New",       icon: Sparkles    },
  { id: "roadmap",       label: "Roadmap",           icon: Map         },
  { id: "announcements", label: "Announcements",     icon: Megaphone   },
  { id: "feedback",      label: "Feedback",          icon: MessageSquare },
  { id: "bugs",          label: "Bug Reports",       icon: Bug         },
  { id: "features",      label: "Feature Requests",  icon: Lightbulb   },
];

// ─── Status badge helper ──────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    open:         "bg-blue-50 text-blue-700",
    planned:      "bg-amber-50 text-amber-700",
    in_progress:  "bg-indigo-50 text-indigo-700",
    completed:    "bg-emerald-50 text-emerald-700",
    closed:       "bg-slate-100 text-slate-500",
    fixed:        "bg-emerald-50 text-emerald-700",
    duplicate:    "bg-rose-50 text-rose-600",
    in_development: "bg-emerald-50 text-emerald-700",
    researching:  "bg-blue-50 text-blue-700",
    future:       "bg-slate-100 text-slate-500",
    declined:     "bg-red-50 text-red-600",
  };
  return (
    <span className={cn("inline-flex px-2 py-0.5 rounded-full text-xs font-semibold capitalize", colors[status] ?? "bg-slate-100 text-slate-600")}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function SeverityPill({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    low:      "bg-emerald-50 text-emerald-700",
    medium:   "bg-amber-50 text-amber-700",
    high:     "bg-orange-50 text-orange-700",
    critical: "bg-red-50 text-red-700 font-bold",
  };
  return <span className={cn("inline-flex px-2 py-0.5 rounded-full text-xs font-semibold capitalize", colors[severity] ?? "bg-slate-100 text-slate-600")}>{severity}</span>;
}

// ─── Releases ─────────────────────────────────────────────────────────────────

const EMPTY_RELEASE = { version: "", releaseDate: "", category: "new_feature", title: "", description: "", imageUrl: "", videoUrl: "", docUrl: "", highlights: "", isMajor: false, isPublished: false };

function ReleasesPanel() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>(EMPTY_RELEASE);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await hubFetch("admin/releases")); } catch { toast({ title: "Failed to load", variant: "destructive" }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openNew() { setForm(EMPTY_RELEASE); setEditing({}); }
  function openEdit(item: any) {
    setForm({
      ...item,
      releaseDate: item.releaseDate ? item.releaseDate.slice(0, 10) : "",
      highlights: (item.highlights ?? []).join("\n"),
    });
    setEditing(item);
  }

  async function save() {
    if (!form.version || !form.title || !form.description || !form.releaseDate) {
      toast({ title: "Please fill all required fields", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      const payload = { ...form, highlights: form.highlights ? form.highlights.split("\n").map((s: string) => s.trim()).filter(Boolean) : [] };
      if (editing?.id) await hubFetch(`admin/releases/${editing.id}`, { method: "PUT", body: JSON.stringify(payload) });
      else             await hubFetch("admin/releases", { method: "POST", body: JSON.stringify(payload) });
      toast({ title: editing?.id ? "Release updated" : "Release created" });
      setEditing(null); load();
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  }

  async function del(id: number) {
    setDeleting(id);
    try { await hubFetch(`admin/releases/${id}`, { method: "DELETE" }); load(); }
    catch { toast({ title: "Failed to delete", variant: "destructive" }); }
    finally { setDeleting(null); }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-slate-800">Releases ({items.length})</h3>
        <Button size="sm" className="rounded-xl gap-1.5" onClick={openNew}><Plus className="h-3.5 w-3.5" />New Release</Button>
      </div>

      {editing !== null && (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
          <h4 className="font-semibold text-slate-800">{editing?.id ? "Edit Release" : "New Release"}</h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs font-semibold">Version *</Label><Input value={form.version} onChange={e => setForm((f: any) => ({...f, version: e.target.value}))} placeholder="1.4.0" className="rounded-xl h-8 text-sm" /></div>
            <div className="space-y-1.5"><Label className="text-xs font-semibold">Release Date *</Label><Input type="date" value={form.releaseDate} onChange={e => setForm((f: any) => ({...f, releaseDate: e.target.value}))} className="rounded-xl h-8 text-sm" /></div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Category *</Label>
              <select value={form.category} onChange={e => setForm((f: any) => ({...f, category: e.target.value}))} className="w-full h-8 rounded-xl border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
                <option value="new_feature">🚀 New Feature</option>
                <option value="improvement">⚡ Improvement</option>
                <option value="bug_fix">🐞 Bug Fix</option>
                <option value="security">🔒 Security Update</option>
              </select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs font-semibold">Title *</Label><Input value={form.title} onChange={e => setForm((f: any) => ({...f, title: e.target.value}))} className="rounded-xl h-8 text-sm" /></div>
          </div>
          <div className="space-y-1.5"><Label className="text-xs font-semibold">Description *</Label><Textarea value={form.description} onChange={e => setForm((f: any) => ({...f, description: e.target.value}))} className="rounded-xl resize-none min-h-[80px] text-sm" /></div>
          <div className="space-y-1.5"><Label className="text-xs font-semibold">Highlights (one per line — shown in version popup)</Label><Textarea value={form.highlights} onChange={e => setForm((f: any) => ({...f, highlights: e.target.value}))} placeholder={"Email Verification\nPassword Reset\nAI Morning Brief"} className="rounded-xl resize-none min-h-[80px] text-sm font-mono" /></div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5"><Label className="text-xs font-semibold">Image URL</Label><Input value={form.imageUrl} onChange={e => setForm((f: any) => ({...f, imageUrl: e.target.value}))} className="rounded-xl h-8 text-sm" /></div>
            <div className="space-y-1.5"><Label className="text-xs font-semibold">Video URL</Label><Input value={form.videoUrl} onChange={e => setForm((f: any) => ({...f, videoUrl: e.target.value}))} className="rounded-xl h-8 text-sm" /></div>
            <div className="space-y-1.5"><Label className="text-xs font-semibold">Docs URL</Label><Input value={form.docUrl} onChange={e => setForm((f: any) => ({...f, docUrl: e.target.value}))} className="rounded-xl h-8 text-sm" /></div>
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.isMajor} onChange={e => setForm((f: any) => ({...f, isMajor: e.target.checked}))} className="rounded accent-indigo-600" />
              <span className="text-sm text-slate-700">Major release (shows version popup)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.isPublished} onChange={e => setForm((f: any) => ({...f, isPublished: e.target.checked}))} className="rounded accent-indigo-600" />
              <span className="text-sm text-slate-700">Published</span>
            </label>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="rounded-xl gap-1.5" onClick={save} disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{saving ? "Saving…" : "Save"}</Button>
            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {loading ? <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}</div> : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id} className="flex items-center gap-3 p-3.5 bg-white rounded-xl border border-slate-200">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">v{item.version}</span>
                  <span className="text-sm font-semibold text-slate-800 truncate">{item.title}</span>
                  {item.isMajor && <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full font-semibold">Major</span>}
                  <span className={cn("text-xs px-2 py-0.5 rounded-full font-semibold", item.isPublished ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}>{item.isPublished ? "Published" : "Draft"}</span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">{new Date(item.releaseDate).toLocaleDateString()}</p>
              </div>
              <button onClick={() => openEdit(item)} className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
              <button onClick={() => del(item.id)} disabled={deleting === item.id} className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50">
                {deleting === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </div>
          ))}
          {items.length === 0 && <p className="text-sm text-slate-400 py-8 text-center">No releases yet. Create your first one.</p>}
        </div>
      )}
    </div>
  );
}

// ─── Roadmap ──────────────────────────────────────────────────────────────────

const EMPTY_ROADMAP = { title: "", description: "", status: "planned", category: "general", progress: 0, estimatedRelease: "", sortOrder: 0, isPublished: true };

function RoadmapPanel() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>(EMPTY_ROADMAP);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await hubFetch("admin/roadmap")); } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!form.title || !form.description) { toast({ title: "Title and description required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      if (editing?.id) await hubFetch(`admin/roadmap/${editing.id}`, { method: "PUT", body: JSON.stringify(form) });
      else             await hubFetch("admin/roadmap", { method: "POST", body: JSON.stringify(form) });
      toast({ title: "Saved" }); setEditing(null); load();
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  }

  async function del(id: number) {
    setDeleting(id);
    try { await hubFetch(`admin/roadmap/${id}`, { method: "DELETE" }); load(); }
    catch { toast({ title: "Failed", variant: "destructive" }); }
    finally { setDeleting(null); }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-slate-800">Roadmap Items ({items.length})</h3>
        <Button size="sm" className="rounded-xl gap-1.5" onClick={() => { setForm(EMPTY_ROADMAP); setEditing({}); }}><Plus className="h-3.5 w-3.5" />New Item</Button>
      </div>

      {editing !== null && (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
          <h4 className="font-semibold text-slate-800">{editing?.id ? "Edit Roadmap Item" : "New Roadmap Item"}</h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5"><Label className="text-xs font-semibold">Title *</Label><Input value={form.title} onChange={e => setForm((f: any) => ({...f, title: e.target.value}))} className="rounded-xl h-8 text-sm" /></div>
            <div className="col-span-2 space-y-1.5"><Label className="text-xs font-semibold">Description *</Label><Textarea value={form.description} onChange={e => setForm((f: any) => ({...f, description: e.target.value}))} className="rounded-xl resize-none min-h-[80px] text-sm" /></div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Status</Label>
              <select value={form.status} onChange={e => setForm((f: any) => ({...f, status: e.target.value}))} className="w-full h-8 rounded-xl border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
                <option value="in_development">🟢 In Development</option>
                <option value="planned">🟡 Planned</option>
                <option value="researching">🔵 Researching</option>
                <option value="future">⚪ Future</option>
              </select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs font-semibold">Category</Label><Input value={form.category} onChange={e => setForm((f: any) => ({...f, category: e.target.value}))} className="rounded-xl h-8 text-sm" /></div>
            <div className="space-y-1.5"><Label className="text-xs font-semibold">Progress % (0-100)</Label><Input type="number" min={0} max={100} value={form.progress} onChange={e => setForm((f: any) => ({...f, progress: parseInt(e.target.value)||0}))} className="rounded-xl h-8 text-sm" /></div>
            <div className="space-y-1.5"><Label className="text-xs font-semibold">Estimated Release</Label><Input value={form.estimatedRelease} onChange={e => setForm((f: any) => ({...f, estimatedRelease: e.target.value}))} placeholder="Q2 2025" className="rounded-xl h-8 text-sm" /></div>
            <div className="space-y-1.5"><Label className="text-xs font-semibold">Sort Order</Label><Input type="number" value={form.sortOrder} onChange={e => setForm((f: any) => ({...f, sortOrder: parseInt(e.target.value)||0}))} className="rounded-xl h-8 text-sm" /></div>
            <div className="flex items-center gap-2 pt-5">
              <input type="checkbox" checked={form.isPublished} onChange={e => setForm((f: any) => ({...f, isPublished: e.target.checked}))} className="rounded accent-indigo-600" id="rm-pub" />
              <label htmlFor="rm-pub" className="text-sm text-slate-700 cursor-pointer">Published</label>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="rounded-xl gap-1.5" onClick={save} disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{saving ? "Saving…" : "Save"}</Button>
            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {loading ? <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}</div> : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id} className="flex items-center gap-3 p-3.5 bg-white rounded-xl border border-slate-200">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-slate-800 truncate">{item.title}</span>
                  <StatusPill status={item.status} />
                  <span className="text-xs text-slate-400">❤️ {item.voteCount}</span>
                  {item.progress > 0 && <span className="text-xs text-slate-400">{item.progress}%</span>}
                </div>
                {item.estimatedRelease && <p className="text-xs text-slate-400 mt-0.5">Est. {item.estimatedRelease}</p>}
              </div>
              <button onClick={() => { setForm({...item, estimatedRelease: item.estimatedRelease ?? ""}); setEditing(item); }} className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
              <button onClick={() => del(item.id)} disabled={deleting === item.id} className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50">
                {deleting === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </div>
          ))}
          {items.length === 0 && <p className="text-sm text-slate-400 py-8 text-center">No roadmap items yet.</p>}
        </div>
      )}
    </div>
  );
}

// ─── Announcements ────────────────────────────────────────────────────────────

const EMPTY_ANN = { message: "", backgroundColor: "#3b82f6", priority: 0, startDate: "", endDate: "", isDismissible: true, link: "", linkLabel: "", isActive: true };

function AnnouncementsPanel() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>(EMPTY_ANN);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await hubFetch("admin/announcements")); } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!form.message?.trim()) { toast({ title: "Message required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      if (editing?.id) await hubFetch(`admin/announcements/${editing.id}`, { method: "PUT", body: JSON.stringify(form) });
      else             await hubFetch("admin/announcements", { method: "POST", body: JSON.stringify(form) });
      toast({ title: "Saved" }); setEditing(null); load();
    } catch (e: any) { toast({ title: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  }

  async function del(id: number) {
    setDeleting(id);
    try { await hubFetch(`admin/announcements/${id}`, { method: "DELETE" }); load(); }
    catch { toast({ title: "Failed", variant: "destructive" }); }
    finally { setDeleting(null); }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-slate-800">Announcements ({items.length})</h3>
        <Button size="sm" className="rounded-xl gap-1.5" onClick={() => { setForm(EMPTY_ANN); setEditing({}); }}><Plus className="h-3.5 w-3.5" />New Banner</Button>
      </div>

      {editing !== null && (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
          <h4 className="font-semibold text-slate-800">{editing?.id ? "Edit Announcement" : "New Announcement"}</h4>
          <div className="space-y-1.5"><Label className="text-xs font-semibold">Message *</Label><Textarea value={form.message} onChange={e => setForm((f: any) => ({...f, message: e.target.value}))} className="rounded-xl resize-none min-h-[60px] text-sm" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Background Color</Label>
              <div className="flex gap-2 items-center">
                <input type="color" value={form.backgroundColor} onChange={e => setForm((f: any) => ({...f, backgroundColor: e.target.value}))} className="h-8 w-10 rounded-lg border border-slate-200 cursor-pointer" />
                <Input value={form.backgroundColor} onChange={e => setForm((f: any) => ({...f, backgroundColor: e.target.value}))} className="rounded-xl h-8 text-sm font-mono" />
              </div>
            </div>
            <div className="space-y-1.5"><Label className="text-xs font-semibold">Priority (higher = shown first)</Label><Input type="number" value={form.priority} onChange={e => setForm((f: any) => ({...f, priority: parseInt(e.target.value)||0}))} className="rounded-xl h-8 text-sm" /></div>
            <div className="space-y-1.5"><Label className="text-xs font-semibold">Start Date</Label><Input type="datetime-local" value={form.startDate} onChange={e => setForm((f: any) => ({...f, startDate: e.target.value}))} className="rounded-xl h-8 text-sm" /></div>
            <div className="space-y-1.5"><Label className="text-xs font-semibold">End Date</Label><Input type="datetime-local" value={form.endDate} onChange={e => setForm((f: any) => ({...f, endDate: e.target.value}))} className="rounded-xl h-8 text-sm" /></div>
            <div className="space-y-1.5"><Label className="text-xs font-semibold">Link URL</Label><Input value={form.link} onChange={e => setForm((f: any) => ({...f, link: e.target.value}))} className="rounded-xl h-8 text-sm" /></div>
            <div className="space-y-1.5"><Label className="text-xs font-semibold">Link Label</Label><Input value={form.linkLabel} onChange={e => setForm((f: any) => ({...f, linkLabel: e.target.value}))} className="rounded-xl h-8 text-sm" /></div>
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.isDismissible} onChange={e => setForm((f: any) => ({...f, isDismissible: e.target.checked}))} className="rounded accent-indigo-600" /><span className="text-sm">Dismissible</span></label>
            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.isActive} onChange={e => setForm((f: any) => ({...f, isActive: e.target.checked}))} className="rounded accent-indigo-600" /><span className="text-sm">Active</span></label>
          </div>
          {/* Preview */}
          {form.message && (
            <div className="rounded-xl overflow-hidden border border-slate-200">
              <p className="text-xs text-slate-500 px-3 pt-2 pb-1 font-semibold">Preview:</p>
              <div className="px-4 py-2.5 text-sm font-medium text-center" style={{ backgroundColor: form.backgroundColor }}>
                {form.message}
                {form.linkLabel && <span className="ml-2 underline text-xs">{form.linkLabel}</span>}
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" className="rounded-xl gap-1.5" onClick={save} disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{saving ? "Saving…" : "Save"}</Button>
            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {loading ? <div className="space-y-2">{[1,2].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}</div> : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id} className="flex items-center gap-3 p-3.5 bg-white rounded-xl border border-slate-200">
              <div className="h-6 w-6 rounded-full flex-shrink-0" style={{ backgroundColor: item.backgroundColor }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{item.message}</p>
                <div className="flex gap-2 mt-0.5">
                  <span className={cn("text-xs font-semibold", item.isActive ? "text-emerald-600" : "text-slate-400")}>{item.isActive ? "Active" : "Inactive"}</span>
                  {item.endDate && <span className="text-xs text-slate-400">Ends {new Date(item.endDate).toLocaleDateString()}</span>}
                </div>
              </div>
              <button onClick={() => { setForm({...item, startDate: item.startDate?.slice(0,16)??"", endDate: item.endDate?.slice(0,16)??"", link: item.link??"", linkLabel: item.linkLabel??""}); setEditing(item); }} className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
              <button onClick={() => del(item.id)} disabled={deleting === item.id} className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50">
                {deleting === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </div>
          ))}
          {items.length === 0 && <p className="text-sm text-slate-400 py-8 text-center">No announcements.</p>}
        </div>
      )}
    </div>
  );
}

// ─── Generic inbox panel (feedback/bugs/features) ─────────────────────────────

function InboxPanel({ endpoint, title, renderItem }: {
  endpoint: string; title: string;
  renderItem: (item: any, onReply: (id: number, reply: string, status: string) => Promise<void>) => React.ReactNode;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [replyTarget, setReplyTarget] = useState<any | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyStatus, setReplyStatus] = useState("open");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async (q = "", s = "") => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: "50" });
      if (q) qs.set("q", q);
      if (s) qs.set("status", s);
      const data = await hubFetch(`admin/${endpoint}?${qs}`);
      setItems(data.data ?? []); setTotal(data.total ?? 0);
    } catch { toast({ title: "Failed to load", variant: "destructive" }); }
    finally { setLoading(false); }
  }, [endpoint]);

  useEffect(() => { load(); }, [load]);

  const debounceRef = { current: null as ReturnType<typeof setTimeout> | null };
  function handleSearch(v: string) {
    setSearch(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(v, statusFilter), 350);
  }

  function handleStatusFilter(s: string) {
    setStatusFilter(s);
    load(search, s);
  }

  async function handleReply(id: number, reply: string, status: string) {
    setSaving(true);
    try {
      await hubFetch(`admin/${endpoint}/${id}`, { method: "PUT", body: JSON.stringify({ adminReply: reply, status }) });
      toast({ title: "Reply sent" }); setReplyTarget(null); setReplyText(""); load(search, statusFilter);
    } catch { toast({ title: "Failed", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  function openReply(item: any) {
    setReplyTarget(item); setReplyText(item.adminReply ?? ""); setReplyStatus(item.status);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-semibold text-slate-800">{title} ({total})</h3>
        <div className="flex gap-2 items-center">
          <Input value={search} onChange={e => handleSearch(e.target.value)} placeholder="Search…" className="rounded-xl h-8 text-sm w-40" />
          <select value={statusFilter} onChange={e => handleStatusFilter(e.target.value)}
            className="h-8 rounded-xl border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="planned">Planned</option>
            <option value="completed">Completed</option>
            <option value="closed">Closed</option>
            <option value="fixed">Fixed</option>
            <option value="duplicate">Duplicate</option>
          </select>
          <Button size="sm" variant="outline" className="rounded-xl gap-1.5 h-8" onClick={() => load(search, statusFilter)}><RefreshCw className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      {/* Reply modal */}
      {replyTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setReplyTarget(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-slate-200 p-5 space-y-4 z-10">
            <div className="flex justify-between items-start">
              <h4 className="font-semibold text-slate-900">{replyTarget.title}</h4>
              <button onClick={() => setReplyTarget(null)}><X className="h-4 w-4 text-slate-400" /></button>
            </div>
            <p className="text-sm text-slate-600 max-h-28 overflow-y-auto bg-slate-50 rounded-xl p-3">{replyTarget.description}</p>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Admin Reply</Label>
              <Textarea value={replyText} onChange={e => setReplyText(e.target.value)} className="rounded-xl resize-none min-h-[100px] text-sm" placeholder="Write your reply…" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Update Status</Label>
              <select value={replyStatus} onChange={e => setReplyStatus(e.target.value)} className="w-full h-8 rounded-xl border border-slate-200 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
                <option value="open">Open</option>
                <option value="planned">Planned</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="fixed">Fixed</option>
                <option value="duplicate">Duplicate</option>
                <option value="closed">Closed</option>
                <option value="declined">Declined</option>
              </select>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1 rounded-xl gap-1.5" onClick={() => handleReply(replyTarget.id, replyText, replyStatus)} disabled={saving}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {saving ? "Sending…" : "Send Reply"}
              </Button>
              <Button variant="outline" className="rounded-xl" onClick={() => setReplyTarget(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {loading ? <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div> : (
        <div className="space-y-2">
          {items.map(item => renderItem(item, async (id, reply, status) => { await handleReply(id, reply, status); }))}
          {items.length === 0 && <p className="text-sm text-slate-400 py-8 text-center">Nothing here yet.</p>}
        </div>
      )}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function AdminProductHub() {
  const [tab, setTab] = useState<SubTab>("releases");

  return (
    <div className="space-y-6">
      {/* Sub-tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-slate-100 pb-0 -mb-1">
        {SUB_TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors",
                tab === t.id
                  ? "border-blue-600 text-blue-700 bg-blue-50/50"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50"
              )}>
              <Icon className="h-3.5 w-3.5" />{t.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        {tab === "releases"      && <ReleasesPanel />}
        {tab === "roadmap"       && <RoadmapPanel />}
        {tab === "announcements" && <AnnouncementsPanel />}

        {tab === "feedback" && (
          <InboxPanel endpoint="feedback" title="Feedback" renderItem={(item, onReply) => (
            <div key={item.id} className="flex items-start gap-3 p-3.5 bg-white rounded-xl border border-slate-200">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-slate-800 truncate">{item.title}</span>
                  <StatusPill status={item.status} />
                  <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded capitalize">{item.type?.replace(/_/g," ")}</span>
                  <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded">{item.priority}</span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5 truncate">{item.description}</p>
                {item.adminReply && <p className="text-xs text-blue-600 mt-1 truncate">✓ {item.adminReply}</p>}
                <p className="text-xs text-slate-300 mt-0.5">{new Date(item.createdAt).toLocaleDateString()}</p>
              </div>
              <Button size="sm" variant="outline" className="rounded-xl gap-1 h-7 text-xs flex-shrink-0" onClick={() => onReply(item.id, item.adminReply ?? "", item.status)}>
                <Send className="h-3 w-3" />Reply
              </Button>
            </div>
          )} />
        )}

        {tab === "bugs" && (
          <InboxPanel endpoint="bug-reports" title="Bug Reports" renderItem={(item, onReply) => (
            <div key={item.id} className="flex items-start gap-3 p-3.5 bg-white rounded-xl border border-slate-200">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-slate-800 truncate">{item.title}</span>
                  <StatusPill status={item.status} />
                  <SeverityPill severity={item.severity} />
                  {item.assignedTo && <span className="text-xs text-slate-500">→ {item.assignedTo}</span>}
                </div>
                <p className="text-xs text-slate-400 mt-0.5 truncate">{item.description}</p>
                {item.adminReply && <p className="text-xs text-blue-600 mt-1 truncate">✓ {item.adminReply}</p>}
                <p className="text-xs text-slate-300 mt-0.5">{new Date(item.createdAt).toLocaleDateString()}</p>
              </div>
              <Button size="sm" variant="outline" className="rounded-xl gap-1 h-7 text-xs flex-shrink-0" onClick={() => onReply(item.id, item.adminReply ?? "", item.status)}>
                <Send className="h-3 w-3" />Reply
              </Button>
            </div>
          )} />
        )}

        {tab === "features" && (
          <InboxPanel endpoint="feature-requests" title="Feature Requests" renderItem={(item, onReply) => (
            <div key={item.id} className="flex items-start gap-3 p-3.5 bg-white rounded-xl border border-slate-200">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-slate-800 truncate">{item.title}</span>
                  <StatusPill status={item.status} />
                  <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded capitalize">{item.category}</span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5 truncate">{item.description}</p>
                {item.businessImpact && <p className="text-xs text-slate-500 mt-0.5">Impact: {item.businessImpact}</p>}
                {item.adminReply && <p className="text-xs text-blue-600 mt-1 truncate">✓ {item.adminReply}</p>}
                <p className="text-xs text-slate-300 mt-0.5">{new Date(item.createdAt).toLocaleDateString()}</p>
              </div>
              <Button size="sm" variant="outline" className="rounded-xl gap-1 h-7 text-xs flex-shrink-0" onClick={() => onReply(item.id, item.adminReply ?? "", item.status)}>
                <Send className="h-3 w-3" />Reply
              </Button>
            </div>
          )} />
        )}
      </div>
    </div>
  );
}
