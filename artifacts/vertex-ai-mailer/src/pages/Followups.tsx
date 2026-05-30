import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  UploadCloud,
  File,
  Send,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import Papa from "papaparse";

interface FollowupOption {
  subject: string;
  body: string;
  tone: string;
}

interface LeadRow {
  name?: string | null;
  email?: string | null;
  vehicle?: string | null;
  pickup?: string | null;
  delivery?: string | null;
  price?: string | null;
  [key: string]: string | null | undefined;
}

type Step = "prompt" | "options" | "upload" | "done";

const TONE_COLORS: Record<string, string> = {
  professional: "bg-blue-50 border-blue-200 text-blue-700",
  friendly: "bg-green-50 border-green-200 text-green-700",
  urgent: "bg-orange-50 border-orange-200 text-orange-700",
  sales: "bg-purple-50 border-purple-200 text-purple-700",
  followup: "bg-slate-50 border-slate-200 text-slate-700",
};

const EXAMPLE_PROMPTS = [
  "Follow up with customers who haven't replied in 3+ days about their auto transport quote",
  "Re-engage customers who asked for a quote but went silent",
  "Remind customers their vehicle shipping window is opening soon",
  "Follow up with warm leads who showed interest but didn't book",
];

export default function Followups() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("prompt");
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [options, setOptions] = useState<FollowupOption[]>([]);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [isCreatingDrafts, setIsCreatingDrafts] = useState(false);
  const [draftResult, setDraftResult] = useState<{ created: number; failed: number } | null>(null);

  async function handleGenerateOptions() {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch("/api/ai/generate-followups", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ prompt: prompt.trim(), count: 3 }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const data = (await res.json()) as { options: FollowupOption[] };
      setOptions(data.options);
      setStep("options");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Generation failed", description: err.message });
    } finally {
      setIsGenerating(false);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: (result) => {
        const rows: LeadRow[] = result.data.map((row) => ({
          name: row["name"] || row["full name"] || row["contact name"] || null,
          email: row["email"] || row["email address"] || row["e-mail"] || null,
          vehicle: row["vehicle"] || row["vehicle type"] || row["car"] || row["make"] || null,
          pickup: row["pickup"] || row["origin"] || row["from"] || null,
          delivery: row["delivery"] || row["destination"] || row["to"] || null,
          price: row["price"] || row["rate"] || row["quote"] || null,
        }));
        const valid = rows.filter(
          (r) => r.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)
        );
        if (valid.length === 0) {
          toast({ variant: "destructive", title: "No valid leads", description: "No rows with valid email addresses found." });
          return;
        }
        setLeads(valid);
      },
      error: () => {
        toast({ variant: "destructive", title: "Parse error", description: "Could not read the CSV file." });
      },
    });
  }

  function applyPlaceholders(text: string, lead: LeadRow): string {
    return text
      .replace(/\{name\}/g, lead.name ?? "there")
      .replace(/\{vehicle\}/g, lead.vehicle ?? "your vehicle")
      .replace(/\{pickup\}/g, lead.pickup ?? "pickup location")
      .replace(/\{delivery\}/g, lead.delivery ?? "delivery location")
      .replace(/\{price\}/g, lead.price ?? "your quoted price");
  }

  async function handleCreateDrafts() {
    if (selectedOption === null || leads.length === 0) return;
    const option = options[selectedOption];
    setIsCreatingDrafts(true);
    let created = 0;
    let failed = 0;

    const token = localStorage.getItem("auth_token");

    for (const lead of leads) {
      if (!lead.email) { failed++; continue; }
      try {
        const res = await fetch("/api/drafts/create-direct", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            to: lead.email,
            subject: applyPlaceholders(option.subject, lead),
            body: applyPlaceholders(option.body, lead),
          }),
        });
        if (res.ok) created++;
        else failed++;
      } catch {
        failed++;
      }
    }

    setDraftResult({ created, failed });
    setStep("done");
    setIsCreatingDrafts(false);
  }

  function handleReset() {
    setStep("prompt");
    setPrompt("");
    setOptions([]);
    setSelectedOption(null);
    setLeads([]);
    setFileName("");
    setDraftResult(null);
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">AI Followups</h2>
        <p className="text-muted-foreground mt-1">
          Describe your follow-up scenario — AI generates 3 ready-to-use email options, then you upload leads and create Gmail drafts.
        </p>
      </div>

      {/* Progress steps */}
      <div className="flex items-center gap-2 text-sm">
        {(["prompt", "options", "upload", "done"] as Step[]).map((s, i) => {
          const labels: Record<Step, string> = { prompt: "Describe", options: "Pick Option", upload: "Add Leads", done: "Done" };
          const done = ["prompt", "options", "upload", "done"].indexOf(step) > i;
          const active = step === s;
          return (
            <div key={s} className="flex items-center gap-2">
              <span className={`flex items-center gap-1.5 ${active ? "text-primary font-medium" : done ? "text-green-600" : "text-muted-foreground"}`}>
                {done ? <CheckCircle2 className="h-4 w-4" /> : <span className="h-5 w-5 rounded-full border-2 flex items-center justify-center text-xs font-bold">{i + 1}</span>}
                {labels[s]}
              </span>
              {i < 3 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
            </div>
          );
        })}
      </div>

      {/* Step 1: Describe scenario */}
      {step === "prompt" && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">What follow-up situation are you handling?</label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="E.g. Follow up with customers who asked for a shipping quote 3 days ago but haven't responded..."
                className="min-h-[100px] resize-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerateOptions();
                }}
              />
              <p className="text-xs text-muted-foreground">Press Cmd/Ctrl+Enter to generate</p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Examples</p>
              <div className="grid gap-2">
                {EXAMPLE_PROMPTS.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => setPrompt(ex)}
                    className="text-left text-sm px-3 py-2 rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-colors text-muted-foreground hover:text-foreground"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>

            <Button
              className="w-full"
              disabled={!prompt.trim() || isGenerating}
              onClick={handleGenerateOptions}
            >
              {isGenerating ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating options…</>
              ) : (
                <><Sparkles className="mr-2 h-4 w-4" /> Generate 3 Email Options</>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Pick an option */}
      {step === "options" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">Pick the best option for your situation</p>
            <Button variant="ghost" size="sm" onClick={() => setStep("prompt")}>
              ← Back
            </Button>
          </div>

          {options.map((opt, i) => (
            <div
              key={i}
              onClick={() => setSelectedOption(i)}
              className={`rounded-xl border-2 p-5 cursor-pointer transition-all ${
                selectedOption === i ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:border-primary/40"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border capitalize ${TONE_COLORS[opt.tone] ?? TONE_COLORS.professional}`}>
                      {opt.tone}
                    </span>
                    <span className="text-xs text-muted-foreground">Option {i + 1}</span>
                  </div>
                  <p className="font-medium text-sm mb-1">{opt.subject}</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-line line-clamp-3">{opt.body}</p>
                </div>
                <div className={`h-5 w-5 rounded-full border-2 flex-shrink-0 mt-1 flex items-center justify-center ${selectedOption === i ? "border-primary bg-primary" : "border-slate-300"}`}>
                  {selectedOption === i && <div className="h-2 w-2 rounded-full bg-white" />}
                </div>
              </div>
            </div>
          ))}

          <div className="flex gap-2">
            <Button variant="outline" onClick={handleGenerateOptions} disabled={isGenerating} className="flex-1">
              {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Regenerate
            </Button>
            <Button
              className="flex-2"
              disabled={selectedOption === null}
              onClick={() => setStep("upload")}
            >
              Use This Option <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Upload leads */}
      {step === "upload" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">Upload your leads CSV</p>
            <Button variant="ghost" size="sm" onClick={() => setStep("options")}>
              ← Back
            </Button>
          </div>

          {/* Selected template preview */}
          {selectedOption !== null && (
            <div className="p-4 rounded-xl border border-primary/20 bg-primary/5">
              <p className="text-xs font-semibold text-primary mb-1">Selected: Option {selectedOption + 1} ({options[selectedOption].tone})</p>
              <p className="text-sm font-medium">{options[selectedOption].subject}</p>
            </div>
          )}

          <Card>
            <CardContent className="p-6">
              {!fileName ? (
                <div
                  className="border-2 border-dashed border-border rounded-xl p-10 text-center cursor-pointer hover:border-primary/50 transition-colors bg-muted/20"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <UploadCloud className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
                  <p className="font-medium text-sm mb-1">Click to upload leads CSV</p>
                  <p className="text-xs text-muted-foreground">Needs: name, email columns. Optional: vehicle, pickup, delivery, price</p>
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept=".csv"
                    onChange={handleFileSelect}
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border">
                    <File className="h-6 w-6 text-primary" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{fileName}</p>
                      <p className="text-xs text-muted-foreground">{leads.length} valid leads found</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => { setFileName(""); setLeads([]); }}>Remove</Button>
                  </div>
                  <Button
                    className="w-full"
                    disabled={leads.length === 0 || isCreatingDrafts}
                    onClick={handleCreateDrafts}
                  >
                    {isCreatingDrafts ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating drafts…</>
                    ) : (
                      <><Send className="mr-2 h-4 w-4" /> Create {leads.length} Gmail Drafts</>
                    )}
                  </Button>
                  <p className="text-xs text-center text-muted-foreground">Drafts are saved to Gmail — they are never sent automatically.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step 4: Done */}
      {step === "done" && draftResult && (
        <Card>
          <CardContent className="p-8 text-center space-y-4">
            <div className="h-16 w-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-8 w-8 text-green-500" />
            </div>
            <div>
              <h3 className="text-xl font-bold">Drafts Created!</h3>
              <p className="text-muted-foreground mt-1">
                {draftResult.created} drafts saved to Gmail
                {draftResult.failed > 0 && ` · ${draftResult.failed} failed`}
              </p>
            </div>
            <div className="flex gap-3 justify-center">
              <Button variant="outline" asChild>
                <a href="https://mail.google.com/mail/u/0/#drafts" target="_blank" rel="noreferrer">
                  Open Gmail Drafts
                </a>
              </Button>
              <Button onClick={handleReset}>
                <RefreshCw className="mr-2 h-4 w-4" />
                New Followup
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
