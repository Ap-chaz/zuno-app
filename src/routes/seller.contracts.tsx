import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Inbox, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { TopBar } from "@/components/zuno/TopBar";
import { KycRequiredDialog } from "@/components/zuno/KycRequiredDialog";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/StateViews";
import { isKycVerified } from "@/lib/zuno-kyc";
import { useContracts, useRespondToContract } from "@/hooks/queries/useContracts";
import { formatCurrency } from "@/services/transactions.service";
import { DELIVERY_METHODS, type Contract } from "@/services/contracts.service";
import { formatDateNairobi } from "@/lib/api/mappers";

export const Route = createFileRoute("/seller/contracts")({
  head: () => ({ meta: [{ title: "Deal requests — ZUNO" }] }),
  component: SellerContracts,
});

function SellerContracts() {
  const { data, isLoading, isError, refetch } = useContracts();
  const rows = (data ?? []).filter((c) => c.viewerRole === "seller");
  const open = rows.filter((c) => c.status === "SELLER_REVIEWING");
  const past = rows.filter((c) => c.status !== "SELLER_REVIEWING");

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <TopBar title="Deal requests" />
      <div className="space-y-3 px-4 sm:px-6 pb-8 pt-4">
        {isLoading && <ListSkeleton rows={2} />}
        {isError && <ErrorState description="Couldn't load your requests." onRetry={() => refetch()} />}
        {!isLoading && !isError && rows.length === 0 && (
          <EmptyState icon={Inbox} title="No requests yet" description="When a buyer wants to buy from you, the request appears here." />
        )}
        {open.map((c) => <RequestCard key={c.id} c={c} />)}
        {past.length > 0 && <p className="pt-3 text-xs font-bold tracking-[0.18em] text-muted-foreground">EARLIER</p>}
        {past.map((c) => (
          <div key={c.id} className="rounded-2xl border border-border/40 bg-surface p-4 text-sm">
            <div className="flex justify-between gap-2">
              <p className="truncate font-semibold">{c.itemName}</p>
              <span className="text-[10px] font-semibold text-muted-foreground">{c.status.replace("_", " ")}</span>
            </div>
            <p className="text-xs text-muted-foreground">{c.buyerName} · {formatCurrency(c.amount)} · {formatDateNairobi(c.createdAt)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function RequestCard({ c }: { c: Contract }) {
  const respond = useRespondToContract();
  const [text, setText] = useState("");
  const [kycOpen, setKycOpen] = useState(false);

  const act = (action: "confirm" | "reject") => {
    if (action === "confirm" && !isKycVerified()) {
      setKycOpen(true);
      return;
    }
    if (text.trim().length < (action === "confirm" ? 20 : 3)) {
      toast.error(action === "confirm"
        ? "Write what you will deliver (at least 20 characters). This is your written agreement."
        : "Tell the buyer why you can't do this deal.");
      return;
    }
    respond.mutate(
      { id: c.id, action, text: text.trim() },
      {
        onSuccess: () => toast.success(action === "confirm"
          ? "Agreed. The buyer has been texted a payment link."
          : "Request declined."),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save your answer."),
      },
    );
  };

  return (
    <div className="rounded-3xl border border-gold/30 bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{c.itemName}</p>
          <p className="text-xs text-muted-foreground">From {c.buyerName}</p>
        </div>
        <p className="text-lg font-bold">{formatCurrency(c.amount)}</p>
      </div>
      <p className="mt-3 text-[10px] font-bold tracking-wider text-muted-foreground">THE BUYER EXPECTS</p>
      <p className="mt-1 whitespace-pre-wrap text-sm">{c.buyerExpectations}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        {DELIVERY_METHODS.find((d) => d.id === c.deliveryMethod)?.label ?? c.deliveryMethod}
        {c.deliveryLocation ? ` · ${c.deliveryLocation}` : ""} · respond before {formatDateNairobi(c.expiresAt, true)}
      </p>
      <textarea
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Your written answer: exactly what you will deliver, or why you can't"
        className="mt-3 w-full rounded-2xl border border-border/60 bg-input px-4 py-3 text-sm outline-none focus:border-gold/50"
      />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button onClick={() => act("reject")} disabled={respond.isPending}
          className="h-11 rounded-2xl border border-border bg-surface text-sm font-semibold disabled:opacity-60">Decline</button>
        <button onClick={() => act("confirm")} disabled={respond.isPending}
          className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-gradient-gold text-sm font-semibold text-gold-foreground shadow-gold disabled:opacity-60">
          {respond.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Agree
        </button>
      </div>
      <KycRequiredDialog open={kycOpen} onOpenChange={setKycOpen} title="Verify your identity to accept deals"
        description="Sellers complete identity verification (KYC) before they can accept deals. It only takes a few minutes." />
    </div>
  );
}
