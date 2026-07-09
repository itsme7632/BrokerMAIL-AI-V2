import { useState, useEffect } from "react";
import { X, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface Announcement {
  id: number; message: string; backgroundColor: string; isDismissible: boolean;
  link?: string | null; linkLabel?: string | null;
}

const DISMISSED_KEY = "dismissed_announcements_v1";

function getDismissed(): number[] {
  try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]"); } catch { return []; }
}

function addDismissed(id: number) {
  const list = getDismissed();
  if (!list.includes(id)) list.push(id);
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(list));
}

/** Picks a readable text color based on background brightness. */
function textColor(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? "#1e293b" : "#ffffff";
}

export function HeaderBanner() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [visible, setVisible]           = useState(false);

  useEffect(() => {
    fetch("/api/product-hub/announcements/active")
      .then(r => r.ok ? r.json() : null)
      .then((data: Announcement | null) => {
        if (!data) return;
        const dismissed = getDismissed();
        if (!dismissed.includes(data.id)) {
          setAnnouncement(data);
          setVisible(true);
        }
      })
      .catch(() => {});
  }, []);

  function dismiss() {
    if (!announcement) return;
    addDismissed(announcement.id);
    setVisible(false);
  }

  if (!visible || !announcement) return null;

  const bg   = announcement.backgroundColor || "#3b82f6";
  const text = textColor(bg);

  return (
    <div
      className="relative flex items-center justify-center gap-3 px-4 py-2.5 text-sm font-medium text-center flex-wrap"
      style={{ backgroundColor: bg, color: text }}
    >
      <span className="leading-snug">{announcement.message}</span>

      {announcement.link && (
        <a
          href={announcement.link}
          target={announcement.link.startsWith("http") ? "_blank" : "_self"}
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 underline underline-offset-2 hover:opacity-80 transition-opacity font-semibold flex-shrink-0 text-xs"
          style={{ color: text }}
        >
          {announcement.linkLabel ?? "Learn more"}
          {announcement.link.startsWith("http") && <ExternalLink className="h-3 w-3" />}
        </a>
      )}

      {announcement.isDismissible && (
        <button
          onClick={dismiss}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg transition-opacity hover:opacity-70"
          style={{ color: text }}
          aria-label="Dismiss announcement"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
