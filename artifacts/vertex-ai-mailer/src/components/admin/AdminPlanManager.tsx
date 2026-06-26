import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Pencil, Trash2, Star, EyeOff, Eye, ChevronUp, ChevronDown,
  Save, X, Loader2, DollarSign, Mail, Server, Layers, Zap, HelpCircle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Plan {
  id: number;
  name: string;
  slug: string;
  description: string;
  price: number;
  priceLabel: string;
  isPopular: boolean;
  buttonText: string;
  supportLevel: string;
  monthlyEmailLimit: number;
  smtpAccountsLimit: number;
  campaignsLimit: number;
  batchSendLimit: number;
  features: string[];
  sortOrder: number;
  isActive: boolean;
}

function afetch(path: string, opts?: RequestInit) {
  const t = localStorage.getItem("admin_auth_token") ?? localStorage.getItem("auth_token") ?? "";
  return fetch(`/api/${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
      ...opts?.headers,
    },
  });
}

// ─── Blank plan template ──────────────────────────────────────────────────────

const blank = (): Omit<Plan, "id"> => ({
  name: "",
  slug: "",
  description: "",
  price: 0,
  priceLabel: "Free",
  isPopular: false,
  buttonText: "Request Access",
  supportLevel: "Email",
  monthlyEmailLimit: 500,
  smtpAccountsLimit: 1,
  campaignsLimit: 5,
  batchSendLimit: 50,
  features: [],
  sortOrder: 0,
  isActive: true,
});

// ─── Feature tag editor ───────────────────────────────────────────────────────

function FeatureEditor({ features, onChange }: { features: string[]; onChange: (f: string[]) => void }) {
  const [input, setInput] = useState("");

  function add() {
    const v = input.trim();
    if (!v || features.includes(v)) return;
    onChange([...features, v]);
    setInput("");
  }

  function remove(f: string) {
    onChange(features.filter(x => x !== f));
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="Add feature (press Enter)"
          className="h-9 text-sm"
        />
        <Button type="button" variant="outline" size="sm" onClick={add} className="h-9 px-3">
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {features.map(f => (
          <span key={f} className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-lg text-xs font-medium">
            {f}
            <button type="button" onClick={() => remove(f)} className="text-blue-400 hover:text-red-500 transition-colors">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {features.length === 0 && <p className="text-xs text-slate-400 dark:text-slate-600 italic">No features added yet</p>}
      </div>
    </div>
  );
}

// ─── Plan form (create or edit) ───────────────────────────────────────────────

function PlanForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: Partial<Plan> & { id?: number };
  onSave: (data: Omit<Plan, "id"> & { id?: number }) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<Omit<Plan, "id"> & { id?: number }>({
    ...blank(),
    ...initial,
  });

  function set(field: keyof Omit<Plan, "id">, value: unknown) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function handleSlugify(name: string) {
    const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    set("name", name);
    if (!initial.id) set("slug", s);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onSave(form);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">Plan Name *</span>
          <Input value={form.name} onChange={e => handleSlugify(e.target.value)} placeholder="Growth" className="h-9 text-sm" required />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">Slug (URL-safe) *</span>
          <Input value={form.slug} onChange={e => set("slug", e.target.value)} placeholder="growth" className="h-9 text-sm font-mono" required disabled={!!initial.id} />
          {!!initial.id && <p className="text-[10px] text-slate-400 dark:text-slate-600 mt-1">Slug cannot be changed after creation</p>}
        </label>
      </div>

      <label className="block">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">Description</span>
        <textarea
          value={form.description}
          onChange={e => set("description", e.target.value)}
          placeholder="Perfect for independent brokers scaling their outreach."
          rows={2}
          className="w-full text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-none"
        />
      </label>

      <div className="grid sm:grid-cols-3 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 flex items-center gap-1.5"><DollarSign className="h-3 w-3" />Price (cents)</span>
          <Input type="number" min="0" value={form.price} onChange={e => set("price", parseInt(e.target.value, 10) || 0)} className="h-9 text-sm font-mono" />
          <p className="text-[10px] text-slate-400 dark:text-slate-600 mt-1">e.g. 2900 = $29.00/mo</p>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">Price Label</span>
          <Input value={form.priceLabel} onChange={e => set("priceLabel", e.target.value)} placeholder="$29/mo" className="h-9 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">Button Text</span>
          <Input value={form.buttonText} onChange={e => set("buttonText", e.target.value)} placeholder="Request Access" className="h-9 text-sm" />
        </label>
      </div>

      <div className="grid sm:grid-cols-4 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 flex items-center gap-1.5"><Mail className="h-3 w-3" />Emails/month</span>
          <Input type="number" min="0" value={form.monthlyEmailLimit} onChange={e => set("monthlyEmailLimit", parseInt(e.target.value, 10) || 0)} className="h-9 text-sm font-mono" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 flex items-center gap-1.5"><Server className="h-3 w-3" />Mailboxes</span>
          <Input type="number" min="0" value={form.smtpAccountsLimit} onChange={e => set("smtpAccountsLimit", parseInt(e.target.value, 10) || 0)} className="h-9 text-sm font-mono" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 flex items-center gap-1.5"><Layers className="h-3 w-3" />Campaigns</span>
          <Input type="number" min="0" value={form.campaignsLimit} onChange={e => set("campaignsLimit", parseInt(e.target.value, 10) || 0)} className="h-9 text-sm font-mono" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 flex items-center gap-1.5"><Zap className="h-3 w-3" />Batch size</span>
          <Input type="number" min="0" value={form.batchSendLimit} onChange={e => set("batchSendLimit", parseInt(e.target.value, 10) || 0)} className="h-9 text-sm font-mono" />
        </label>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 flex items-center gap-1.5"><HelpCircle className="h-3 w-3" />Support Level</span>
          <select
            value={form.supportLevel}
            onChange={e => set("supportLevel", e.target.value)}
            className="w-full h-9 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          >
            <option>Community</option>
            <option>Email</option>
            <option>Priority Email</option>
            <option>Dedicated</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">Sort Order</span>
          <Input type="number" min="0" value={form.sortOrder} onChange={e => set("sortOrder", parseInt(e.target.value, 10) || 0)} className="h-9 text-sm font-mono" />
        </label>
      </div>

      <div>
        <span className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2 block">Features (shown on pricing page)</span>
        <FeatureEditor features={form.features || []} onChange={f => set("features", f)} />
      </div>

      <div className="flex items-center gap-5">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.isPopular} onChange={e => set("isPopular", e.target.checked)}
            className="h-4 w-4 rounded accent-blue-600" />
          <span className="text-sm text-slate-700 dark:text-slate-300">Mark as Popular</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.isActive} onChange={e => set("isActive", e.target.checked)}
            className="h-4 w-4 rounded accent-blue-600" />
          <span className="text-sm text-slate-700 dark:text-slate-300">Active (visible on pricing)</span>
        </label>
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
        <Button type="submit" size="sm" disabled={saving} className="h-9 px-5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
          {initial.id ? "Save Changes" : "Create Plan"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} className="h-9 px-4">
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AdminPlanManager() {
  const { toast } = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await afetch("admin/plans");
      if (r.ok) setPlans(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function savePlan(data: Omit<Plan, "id"> & { id?: number }) {
    setSaving(true);
    try {
      const method = data.id ? "PUT" : "POST";
      const url = data.id ? `admin/plans/${data.id}` : "admin/plans";
      const r = await afetch(url, { method, body: JSON.stringify(data) });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error ?? "Failed to save plan");
      toast({ title: data.id ? "Plan updated" : "Plan created", description: data.name });
      setEditingId(null);
      await load();
    } catch (err) {
      toast({ title: "Error", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function deletePlan(id: number) {
    setSaving(true);
    try {
      const r = await afetch(`admin/plans/${id}`, { method: "DELETE" });
      if (!r.ok) { const j = await r.json(); throw new Error(j.error ?? "Delete failed"); }
      toast({ title: "Plan deleted" });
      setConfirmDelete(null);
      await load();
    } catch (err) {
      toast({ title: "Error", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function togglePopular(plan: Plan) {
    await savePlan({ ...plan, isPopular: !plan.isPopular });
  }

  async function toggleActive(plan: Plan) {
    await savePlan({ ...plan, isActive: !plan.isActive });
  }

  async function moveOrder(plan: Plan, dir: -1 | 1) {
    await savePlan({ ...plan, sortOrder: plan.sortOrder + dir });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading plans…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Plan Management</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            All changes reflect instantly on the public pricing page and upgrade modal.
          </p>
        </div>
        {editingId !== "new" && (
          <Button size="sm" onClick={() => setEditingId("new")} className="h-9 px-4 gap-1.5">
            <Plus className="h-4 w-4" />
            New Plan
          </Button>
        )}
      </div>

      {/* New Plan Form */}
      {editingId === "new" && (
        <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-4">Create New Plan</p>
          <PlanForm initial={blank()} onSave={savePlan} onCancel={() => setEditingId(null)} saving={saving} />
        </div>
      )}

      {/* Plan list */}
      <div className="space-y-3">
        {plans.length === 0 && (
          <div className="text-center py-12 text-slate-400 dark:text-slate-600">
            <p className="text-sm">No plans yet. Create your first plan above.</p>
          </div>
        )}

        {plans.map(plan => (
          <div key={plan.id} className={`bg-white dark:bg-slate-800 border rounded-2xl overflow-hidden transition-all ${
            plan.isActive ? "border-slate-200 dark:border-slate-700" : "border-slate-100 dark:border-slate-800 opacity-60"
          }`}>
            {/* Plan header row */}
            <div className="flex items-center gap-3 px-5 py-4">
              {/* Reorder */}
              <div className="flex flex-col gap-0.5">
                <button onClick={() => moveOrder(plan, -1)} className="text-slate-300 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button onClick={() => moveOrder(plan, 1)} className="text-slate-300 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>

              {/* Name & badge */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-900 dark:text-slate-100 text-sm">{plan.name}</span>
                  <span className="font-mono text-xs text-slate-400 dark:text-slate-500">/{plan.slug}</span>
                  {plan.isPopular && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[10px] font-bold">
                      <Star className="h-2.5 w-2.5 fill-current" />
                      Popular
                    </span>
                  )}
                  {!plan.isActive && (
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-[10px] font-medium">Hidden</span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                  <span className="font-semibold text-blue-600 dark:text-blue-400">{plan.priceLabel}</span>
                  <span>{plan.monthlyEmailLimit.toLocaleString()} emails/mo</span>
                  <span>{plan.smtpAccountsLimit} mailbox{plan.smtpAccountsLimit !== 1 ? "es" : ""}</span>
                  <span>{plan.campaignsLimit} campaigns</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => togglePopular(plan)}
                  title={plan.isPopular ? "Remove popular badge" : "Mark as popular"}
                  className={`p-1.5 rounded-lg transition-colors ${plan.isPopular ? "text-amber-500 bg-amber-50 dark:bg-amber-900/30" : "text-slate-400 dark:text-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"}`}
                >
                  <Star className={`h-4 w-4 ${plan.isPopular ? "fill-current" : ""}`} />
                </button>
                <button
                  onClick={() => toggleActive(plan)}
                  title={plan.isActive ? "Hide from pricing" : "Show on pricing"}
                  className="p-1.5 rounded-lg text-slate-400 dark:text-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  {plan.isActive ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => setEditingId(editingId === plan.id ? null : plan.id)}
                  className="p-1.5 rounded-lg text-slate-400 dark:text-slate-600 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                {confirmDelete === plan.id ? (
                  <div className="flex items-center gap-1">
                    <button onClick={() => deletePlan(plan.id)} className="px-2 py-1 rounded text-xs bg-red-500 text-white font-medium hover:bg-red-600">Delete</button>
                    <button onClick={() => setConfirmDelete(null)} className="px-2 py-1 rounded text-xs bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">Cancel</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(plan.id)}
                    className="p-1.5 rounded-lg text-slate-400 dark:text-slate-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Edit form */}
            {editingId === plan.id && (
              <div className="border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-5 py-5">
                <PlanForm initial={plan} onSave={savePlan} onCancel={() => setEditingId(null)} saving={saving} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
