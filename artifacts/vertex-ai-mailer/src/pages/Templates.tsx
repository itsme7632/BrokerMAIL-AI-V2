import { useState } from "react";
import { Link } from "wouter";
import { useGetTemplates, useCreateTemplate, getGetTemplatesQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Plus, FileText, Loader2, ArrowRight, Pencil } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export default function Templates() {
  const { data: templates, isLoading } = useGetTemplates();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createTemplate = useCreateTemplate();

  const handleCreate = () => {
    if (!newTemplateName.trim()) return;
    createTemplate.mutate(
      {
        data: {
          name: newTemplateName,
          subject: "Shipping quote for your {vehicle}",
          body: "Hi {name},\n\nI wanted to reach out about shipping your {vehicle} from {pickup} to {delivery}.\n\nWe can get it done for {price}. Let me know if you'd like to move forward.\n\nBest regards,",
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Template created" });
          setIsCreateOpen(false);
          setNewTemplateName("");
          queryClient.invalidateQueries({ queryKey: getGetTemplatesQueryKey() });
        },
        onError: (err: any) => {
          toast({ variant: "destructive", title: "Error", description: err.message });
        },
      }
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Email Templates</h1>
          <p className="text-slate-500 mt-1 text-sm">
            Write templates with variables like <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded font-mono">{"{name}"}</code>,{" "}
            <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded font-mono">{"{vehicle}"}</code>,{" "}
            <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded font-mono">{"{pickup}"}</code>.
            Any CSV column header works too.
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 rounded-xl shadow-sm">
              <Plus className="h-4 w-4" />
              New Template
            </Button>
          </DialogTrigger>
          <DialogContent className="rounded-2xl">
            <DialogHeader>
              <DialogTitle>Create Template</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Template Name</label>
                <Input
                  placeholder="e.g. Standard Outreach"
                  value={newTemplateName}
                  onChange={e => setNewTemplateName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleCreate(); }}
                  className="rounded-xl border-slate-200"
                />
              </div>
              <p className="text-xs text-slate-400">A starter subject and body will be added. You can edit them after creation.</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)} className="rounded-xl">Cancel</Button>
              <Button onClick={handleCreate} disabled={createTemplate.isPending || !newTemplateName.trim()} className="rounded-xl">
                {createTemplate.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {isLoading ? (
          Array(3).fill(0).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-3">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-24 w-full rounded-xl" />
            </div>
          ))
        ) : !templates?.length ? (
          <div className="col-span-full flex flex-col items-center justify-center py-20 rounded-2xl border-2 border-dashed border-slate-200 bg-white text-slate-400">
            <FileText className="h-12 w-12 mb-3 opacity-30" />
            <p className="font-medium text-slate-600 text-sm">No templates yet</p>
            <p className="text-xs mt-1 mb-4">Create your first template to start sending drafts.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsCreateOpen(true)}
              className="rounded-xl gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" /> New Template
            </Button>
          </div>
        ) : (
          templates.map(template => (
            <div
              key={template.id}
              className="group bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all flex flex-col overflow-hidden"
            >
              <div className="p-5 flex-1">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="h-9 w-9 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                    <FileText className="h-4 w-4 text-blue-600" />
                  </div>
                  <Link
                    href={`/templates/${template.id}`}
                    className="flex items-center gap-1 text-xs text-slate-400 hover:text-blue-600 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Pencil className="h-3 w-3" /> Edit
                  </Link>
                </div>
                <h3 className="font-semibold text-slate-900 text-sm mb-1 truncate">{template.name}</h3>
                <p className="text-xs text-slate-500 truncate mb-3">
                  Subject: {template.subject}
                </p>
                <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                  <p className="text-xs text-slate-500 font-mono leading-relaxed line-clamp-4">
                    {template.body}
                  </p>
                </div>
              </div>
              <div className="px-5 py-3.5 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
                <span className="text-xs text-slate-400">
                  Updated {new Date(template.updatedAt).toLocaleDateString()}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  asChild
                  className="text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg h-7 px-2 gap-1"
                >
                  <Link href={`/templates/${template.id}`}>
                    Edit <ArrowRight className="h-3 w-3" />
                  </Link>
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
