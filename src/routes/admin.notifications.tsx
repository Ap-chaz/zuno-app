import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { LogOut, Send, Loader2, Bell, Receipt, AlertTriangle, ShieldCheck, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { PhoneFrame } from "@/components/zuno/PhoneFrame";
import { TopBar } from "@/components/zuno/TopBar";
import { adminLogout } from "@/lib/admin-auth";
import { useNotifications, useSendNotification } from "@/hooks/queries/useNotifications";
import type { Notification } from "@/types/models";

export const Route = createFileRoute("/admin/notifications")({
  head: () => ({ meta: [{ title: "Notifications — ZUNO Admin" }] }),
  component: AdminNotifications,
});

const TYPE_OPTIONS: { value: Notification["type"]; label: string; icon: typeof Bell }[] = [
  { value: "system", label: "System", icon: Settings2 },
  { value: "transaction", label: "Transaction", icon: Receipt },
  { value: "dispute", label: "Dispute", icon: AlertTriangle },
  { value: "kyc", label: "KYC", icon: ShieldCheck },
];

// NOTE: this mock has one shared notification inbox, not per-user targeting
// — sending here appears in whatever browser has /app/notifications open.
// Real per-user delivery needs a backend + push service.
function AdminNotifications() {
  const { data: notifications, isLoading } = useNotifications();
  const sendNotification = useSendNotification();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<Notification["type"]>("system");

  const canSend = title.trim().length > 0 && body.trim().length > 0;

  function handleSend() {
    if (!canSend) return;
    sendNotification.mutate(
      { title: title.trim(), body: body.trim(), type },
      {
        onSuccess: () => {
          toast.success("Notification sent.");
          setTitle("");
          setBody("");
        },
        onError: () => toast.error("Couldn't send notification."),
      },
    );
  }

  return (
    <PhoneFrame>
      <TopBar
        title="Notifications"
        back="/admin"
        right={
          <button
            type="button"
            onClick={() => {
              adminLogout();
              window.location.reload();
            }}
            className="grid h-10 w-10 place-items-center rounded-xl bg-surface text-muted-foreground hover:bg-surface-2"
            aria-label="Log out of admin"
          >
            <LogOut className="h-4 w-4" />
          </button>
        }
      />

      <div className="px-5 pt-4 pb-8">
        <p className="mb-3 text-xs font-bold tracking-[0.18em] text-muted-foreground">SEND MANUAL NOTIFICATION</p>

        <div className="mb-2 flex gap-1.5">
          {TYPE_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setType(value)}
              className={`flex h-8 items-center gap-1 rounded-lg px-2.5 text-[11px] font-semibold ${
                type === value ? "bg-gold text-gold-foreground" : "bg-surface text-muted-foreground"
              }`}
            >
              <Icon className="h-3 w-3" /> {label}
            </button>
          ))}
        </div>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="mb-2 h-11 w-full rounded-xl border border-border/60 bg-input px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-gold/50"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Message body…"
          rows={3}
          className="mb-2 w-full rounded-xl border border-border/60 bg-input p-3 text-sm outline-none placeholder:text-muted-foreground focus:border-gold/50"
        />
        <button
          type="button"
          disabled={!canSend || sendNotification.isPending}
          onClick={handleSend}
          className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-gold text-sm font-semibold text-gold-foreground disabled:opacity-40"
        >
          {sendNotification.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send
        </button>

        <p className="mb-2 mt-6 text-xs font-bold tracking-[0.18em] text-muted-foreground">RECENTLY SENT</p>
        <div className="space-y-2">
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {notifications?.slice(0, 8).map((n) => (
            <div key={n.id} className="rounded-xl border border-border/40 bg-surface p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold">{n.title}</p>
                <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {n.type}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{n.body}</p>
            </div>
          ))}
        </div>
      </div>
    </PhoneFrame>
  );
}
