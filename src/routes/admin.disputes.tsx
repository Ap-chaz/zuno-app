import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clock, CheckCircle2, XCircle, ArrowLeftRight, ShieldCheck, LogOut, Loader2, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { PhoneFrame } from "@/components/zuno/PhoneFrame";
import { TopBar } from "@/components/zuno/TopBar";
import { AdminGate } from "@/components/zuno/AdminGate";
import { adminLogout } from "@/lib/admin-auth";
import { errorMessage } from "@/lib/api/client";
import { useAdminDisputes } from "@/hooks/queries/useAdmin";
import { disputesService, type AdminResolution } from "@/services/disputes.service";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import type { Dispute, DisputeStatus } from "@/types/models";

export const Route = createFileRoute("/admin/disputes")({
  head: () => ({ meta: [{ title: "Dispute Resolution Center — ZUNO Admin" }] }),
  component: () => (
    <AdminGate>
      <AdminDisputes />
    </AdminGate>
  ),
});

const fmt = (n: number) => `Ksh ${n.toLocaleString("en-KE")}`;

function AdminDisputes() {
  const { data: disputes, isLoading } = useAdminDisputes();
  const open = disputes?.filter((d) => d.status !== "resolved" && d.status !== "rejected") ?? [];
  const closed = disputes?.filter((d) => d.status === "resolved" || d.status === "rejected") ?? [];
  return (
    <PhoneFrame>
      <TopBar title="Dispute Resolution Center" back="/admin"
        right={<button type="button" onClick={() => { adminLogout(); window.location.reload(); }}
          className="grid h-10 w-10 place-items-center rounded-xl bg-surface text-muted-foreground hover:bg-surface-2" aria-label="Log out of admin">
          <LogOut className="h-4 w-4" /></button>} />
      <div className="px-5 pt-4 pb-8">
        <p className="mb-4 text-xs text-muted-foreground">
          Read the evidence and chat, then decide. Your decision moves the money immediately (M-Pesa payout to the recipient).
        </p>
        {isLoading && <p className="text-sm text-muted-foreground">Loading disputes…</p>}
        {!isLoading && open.length === 0 && (
          <div className="rounded-2xl border border-border/40 bg-surface p-4 text-center">
            <CheckCircle2 className="mx-auto h-6 w-6 text-success" />
            <p className="mt-2 text-sm font-semibold">No open disputes</p>
          </div>
        )}
        <div className="space-y-3">{open.map((d) => <DisputeCard key={d.id} dispute={d} open />)}</div>
        {closed.length > 0 && (
          <>
            <p className="mb-3 mt-6 text-xs font-bold tracking-[0.18em] text-muted-foreground">RESOLVED</p>
            <div className="space-y-3">{closed.map((d) => <DisputeCard key={d.id} dispute={d} />)}</div>
          </>
        )}
      </div>
    </PhoneFrame>
  );
}

function DisputeCard({ dispute, open = false }: { dispute: Dispute; open?: boolean }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState("");
  const [buyerAmt, setBuyerAmt] = useState("");
  const detail = useQuery({ queryKey: ["admin", "dispute", dispute.id], queryFn: () => disputesService.adminDetail(dispute.id), enabled: expanded || !open });
  const d = detail.data;

  const resolve = useMutation({
    mutationFn: (v: { resolution: AdminResolution; buyer?: number; seller?: number }) =>
      disputesService.adminResolve({ id: dispute.id, resolution: v.resolution, notes: note.trim(), splitBuyerAmount: v.buyer, splitSellerAmount: v.seller }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin"] }); toast.success("Resolved. Payout queued."); setExpanded(false); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const decide = (resolution: AdminResolution) => {
    if (note.trim().length < 10) return toast.error("Add a resolution note (at least 10 characters).");
    if (resolution !== "SPLIT") {
      if (!confirm(resolution === "REFUND_BUYER" ? "Refund the buyer in full? This cannot be undone." : "Release the funds to the seller? This cannot be undone.")) return;
      return resolve.mutate({ resolution });
    }
    const pool = d?.dispute.sellerReceives ?? 0;
    const b = Math.round(Number(buyerAmt));
    if (!b || b < 1 || b >= pool) return toast.error(`Enter the buyer's share between 1 and ${pool - 1}.`);
    if (!confirm(`Split: buyer ${fmt(b)}, seller ${fmt(pool - b)}. This cannot be undone.`)) return;
    resolve.mutate({ resolution, buyer: b, seller: pool - b });
  };

  return (
    <article className="rounded-2xl border border-border/40 bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold capitalize">{dispute.reason}</p>
          <p className="font-mono text-xs text-muted-foreground">#{dispute.transactionId}</p>
        </div>
        <StatusPill status={dispute.status} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{dispute.description}</p>

      {d && (
        <div className="mt-3 space-y-2 text-xs">
          <p><b>{d.dispute.itemName}</b> · buyer {d.dispute.buyerName} · seller {d.dispute.sellerName}</p>
          <p>Buyer paid {fmt(d.dispute.buyerPays)} · seller's share {fmt(d.dispute.sellerReceives)}</p>
          {d.evidence.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {d.evidence.map((e) => (
                <a key={e.id} href={e.url} target="_blank" rel="noreferrer" className="rounded-lg bg-surface-2 px-2 py-1 underline">{e.role} · {e.type}</a>
              ))}
            </div>
          )}
          {d.messages.length > 0 && (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl bg-surface-2 p-2">
              {d.messages.map((m) => (
                <p key={m.id}><MessageSquare className="mr-1 inline h-3 w-3" /><b>{m.senderRole}:</b> {m.isOffer ? `offer — refund buyer ${fmt(m.offerAmount ?? 0)} (${(m.offerStatus ?? "").toLowerCase()}) ` : ""}{m.text}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {!open && dispute.resolution && (
        <div className="mt-3 rounded-xl bg-surface-2 p-3">
          <p className="text-xs font-semibold">
            {dispute.resolution === "SPLIT" ? `Split — buyer ${fmt(dispute.splitBuyerAmount ?? 0)}, seller ${fmt(dispute.splitSellerAmount ?? 0)}`
              : dispute.resolution === "REFUND_BUYER" ? "Refunded to buyer" : "Released to seller"}
          </p>
          {dispute.resolutionNote && <p className="mt-0.5 text-xs text-muted-foreground">{dispute.resolutionNote}</p>}
        </div>
      )}

      {open && !expanded && (
        <button type="button" onClick={() => setExpanded(true)}
          className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-gradient-gold text-xs font-semibold text-gold-foreground">
          <ArrowLeftRight className="h-3.5 w-3.5" /> Review & resolve
        </button>
      )}

      {open && expanded && (
        <div className="mt-3 space-y-2">
          {detail.isLoading && <Loader2 className="mx-auto h-4 w-4 animate-spin" />}
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Resolution note (shown to both parties)…"
            className="w-full rounded-xl border border-border/60 bg-input p-3 text-xs outline-none focus:border-gold/50" />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={resolve.isPending || !d} onClick={() => decide("REFUND_BUYER")}
              className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-success/15 text-xs font-semibold text-success disabled:opacity-50">
              <ShieldCheck className="h-3.5 w-3.5" /> Refund buyer</button>
            <button type="button" disabled={resolve.isPending || !d} onClick={() => decide("RELEASE_TO_SELLER")}
              className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-gold/15 text-xs font-semibold text-gold disabled:opacity-50">
              <ArrowLeftRight className="h-3.5 w-3.5" /> Release to seller</button>
          </div>
          <div className="flex gap-2">
            <input inputMode="numeric" value={buyerAmt} onChange={(e) => setBuyerAmt(e.target.value)} placeholder="Buyer's share (Ksh)"
              className="h-10 min-w-0 flex-1 rounded-xl border border-border/60 bg-input px-3 text-xs" />
            <button type="button" disabled={resolve.isPending || !d} onClick={() => decide("SPLIT")}
              className="h-10 rounded-xl bg-surface-2 px-4 text-xs font-semibold disabled:opacity-50">Split</button>
          </div>
        </div>
      )}
    </article>
  );
}

function StatusPill({ status }: { status: DisputeStatus }) {
  const config: Record<DisputeStatus, { icon: typeof Clock; label: string; className: string }> = {
    open: { icon: AlertTriangle, label: "Open", className: "bg-destructive/15 text-destructive" },
    negotiating: { icon: MessageSquare, label: "Negotiating", className: "bg-gold/10 text-gold" },
    under_review: { icon: Clock, label: "Escalated", className: "bg-gold/10 text-gold" },
    resolved: { icon: CheckCircle2, label: "Resolved", className: "bg-success/15 text-success" },
    rejected: { icon: XCircle, label: "Dismissed", className: "bg-surface-2 text-muted-foreground" },
  };
  const { icon: Icon, label, className } = config[status];
  return (
    <span className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${className}`}>
      <Icon className="h-3 w-3" /> {label}
    </span>
  );
}
