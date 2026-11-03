import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { LogOut, Mail, Check, Loader2, Clock } from "lucide-react";
import { toast } from "sonner";
import { PhoneFrame } from "@/components/zuno/PhoneFrame";
import { TopBar } from "@/components/zuno/TopBar";
import { adminLogout } from "@/lib/admin-auth";
import { useSupportTickets, useResolveSupportTicket } from "@/hooks/queries/useSupport";
import type { SupportTicket } from "@/types/models";

export const Route = createFileRoute("/admin/support")({
  head: () => ({ meta: [{ title: "Support Tickets — ZUNO Admin" }] }),
  component: AdminSupport,
});

function AdminSupport() {
  const { data: tickets, isLoading } = useSupportTickets();
  const [tab, setTab] = useState<"open" | "resolved">("open");

  const open = useMemo(() => tickets?.filter((t) => t.status === "open") ?? [], [tickets]);
  const resolved = useMemo(() => tickets?.filter((t) => t.status === "resolved") ?? [], [tickets]);
  const shown = tab === "open" ? open : resolved;

  return (
    <PhoneFrame>
      <TopBar
        title="Support Tickets"
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
        <div className="mb-4 flex gap-2">
          <TabButton active={tab === "open"} onClick={() => setTab("open")} label={`Open (${open.length})`} />
          <TabButton active={tab === "resolved"} onClick={() => setTab("resolved")} label={`Resolved (${resolved.length})`} />
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

        <div className="space-y-2">
          {shown.map((t) => (
            <TicketRow key={t.id} ticket={t} />
          ))}
          {!isLoading && shown.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {tab === "open" ? "No open tickets." : "No resolved tickets yet."}
            </p>
          )}
        </div>
      </div>
    </PhoneFrame>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 flex-1 rounded-xl text-xs font-semibold transition-colors ${
        active ? "bg-gradient-gold text-gold-foreground" : "bg-surface text-muted-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function TicketRow({ ticket: t }: { ticket: SupportTicket }) {
  const resolveTicket = useResolveSupportTicket();

  function handleResolve() {
    resolveTicket.mutate(t.id, {
      onSuccess: () => toast.success("Ticket marked resolved."),
      onError: () => toast.error("Couldn't update ticket."),
    });
  }

  return (
    <article className="rounded-2xl border border-border/40 bg-surface p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{t.subject}</p>
          <p className="truncate text-xs text-muted-foreground">
            {t.name} · {t.email}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" /> {new Date(t.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
        </span>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">{t.message}</p>

      <div className="mt-3 flex gap-2">
        <a
          href={`mailto:${t.email}?subject=Re: ${encodeURIComponent(t.subject)}`}
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-gold/10 text-xs font-semibold text-gold"
        >
          <Mail className="h-3.5 w-3.5" /> Reply by email
        </a>
        {t.status === "open" && (
          <button
            type="button"
            disabled={resolveTicket.isPending}
            onClick={handleResolve}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-success/15 text-xs font-semibold text-success disabled:opacity-50"
          >
            {resolveTicket.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Mark resolved
          </button>
        )}
      </div>
    </article>
  );
}
