import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { LogOut, Loader2, RefreshCw, Check, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { PhoneFrame } from "@/components/zuno/PhoneFrame";
import { TopBar } from "@/components/zuno/TopBar";
import { AdminGate } from "@/components/zuno/AdminGate";
import { adminLogout } from "@/lib/admin-auth";
import { errorMessage } from "@/lib/api/client";
import { useAdminPayouts, useRetryPayout } from "@/hooks/queries/useAdmin";
import type { AdminPayout } from "@/services/admin.service";

export const Route = createFileRoute("/admin/payouts")({
  head: () => ({ meta: [{ title: "Payout & Refund Queue — ZUNO Admin" }] }),
  component: () => (
    <AdminGate>
      <AdminPayouts />
    </AdminGate>
  ),
});

const fmt = (n: number) => `Ksh ${n.toLocaleString("en-KE")}`;
const LABEL: Record<AdminPayout["type"], string> = {
  SELLER_RELEASE: "Seller payout", BUYER_REFUND: "Buyer refund", SPLIT_SELLER: "Split · seller", SPLIT_BUYER: "Split · buyer",
};

function AdminPayouts() {
  const [tab, setTab] = useState<"open" | "COMPLETED">("open");
  const { data, isLoading } = useAdminPayouts(tab === "COMPLETED" ? "COMPLETED" : undefined);
  const needsAttention = data?.filter((p) => p.status === "FAILED" || p.status === "NEEDS_REVIEW") ?? [];
  const rest = data?.filter((p) => p.status !== "FAILED" && p.status !== "NEEDS_REVIEW") ?? [];
  return (
    <PhoneFrame>
      <TopBar title="Payout & Refund Queue" back="/admin"
        right={<button type="button" onClick={() => { adminLogout(); window.location.reload(); }}
          className="grid h-10 w-10 place-items-center rounded-xl bg-surface text-muted-foreground hover:bg-surface-2" aria-label="Log out of admin">
          <LogOut className="h-4 w-4" /></button>} />
      <div className="px-5 pt-4 pb-8">
        <p className="mb-4 text-xs text-muted-foreground">
          Payouts and refunds are sent to M-Pesa automatically. Only failed or unconfirmed ones need you.
        </p>
        <div className="mb-4 flex gap-2">
          {([["open", "In progress"], ["COMPLETED", "Paid"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={`h-9 flex-1 rounded-xl text-xs font-semibold ${tab === k ? "bg-gradient-gold text-gold-foreground" : "bg-surface text-muted-foreground"}`}>{l}</button>
          ))}
        </div>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {needsAttention.length > 0 && (
          <>
            <p className="mb-2 text-xs font-bold tracking-[0.18em] text-destructive">NEEDS ATTENTION</p>
            <div className="mb-6 space-y-2">{needsAttention.map((p) => <Row key={p.id} p={p} />)}</div>
          </>
        )}
        <div className="space-y-2">{rest.map((p) => <Row key={p.id} p={p} />)}</div>
        {!isLoading && (data?.length ?? 0) === 0 && (
          <p className="rounded-xl bg-surface p-3 text-center text-xs text-muted-foreground">Nothing here.</p>
        )}
      </div>
    </PhoneFrame>
  );
}

function Row({ p }: { p: AdminPayout }) {
  const retry = useRetryPayout();
  const needsReview = p.status === "NEEDS_REVIEW";
  const doRetry = () => {
    if (needsReview && !confirm("Open the M-Pesa portal and confirm this payment was NOT sent. Retrying a payment that already went out will pay twice. Continue?")) return;
    retry.mutate({ id: p.id, confirmedNotPaid: needsReview }, {
      onSuccess: () => toast.success("Re-queued. It will be sent shortly."),
      onError: (e) => toast.error(errorMessage(e)),
    });
  };
  return (
    <article className="rounded-2xl border border-border/40 bg-surface p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{LABEL[p.type]}</p>
          <p className="truncate text-xs text-muted-foreground"><span className="font-mono">{p.transactionId}</span> · {p.phone}</p>
        </div>
        <span className="shrink-0 text-sm font-bold">{fmt(p.amount)}</span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {p.status.replace("_", " ")}{p.attempts ? ` · ${p.attempts} attempt${p.attempts > 1 ? "s" : ""}` : ""}{p.reference ? ` · ${p.reference}` : ""}
      </p>
      {p.failureReason && <p className="mt-1 flex items-start gap-1 text-xs text-destructive"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{p.failureReason}</p>}
      {(p.status === "FAILED" || needsReview) && (
        <button type="button" disabled={retry.isPending} onClick={doRetry}
          className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-gold text-xs font-semibold text-gold-foreground disabled:opacity-50">
          {retry.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Retry payout
        </button>
      )}
      {p.status === "COMPLETED" && <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-success"><Check className="h-3.5 w-3.5" /> Paid</p>}
    </article>
  );
}
