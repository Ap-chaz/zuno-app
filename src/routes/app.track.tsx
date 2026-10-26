import { createFileRoute, Link } from "@tanstack/react-router";
import { Truck, Package, MessageCircle, AlertCircle, Shield } from "lucide-react";
import { toast } from "sonner";
import { TopBar } from "@/components/zuno/TopBar";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/StateViews";
import { useActiveTransactions } from "@/hooks/queries/useTransactions";
import { formatCurrency } from "@/services/transactions.service";
import { useContracts } from "@/hooks/queries/useContracts";

export const Route = createFileRoute("/app/track")({
  head: () => ({ meta: [{ title: "Track Deliveries — ZUNO" }] }),
  component: TrackDelivery,
});

// Orders funded or in-transit are the ones worth tracking; completed/refunded
// deals belong in Activity instead.
const TRACKABLE = new Set(["Pending", "Funded", "Protected", "In transit", "Inspection", "Disputed"]);

function TrackDelivery() {
  const { data: orders, isLoading, isError, refetch } = useActiveTransactions();
  const trackable = (orders ?? []).filter((t) => TRACKABLE.has(t.status));
  const { data: contracts } = useContracts();
  const waiting = (contracts ?? []).filter((c) => c.viewerRole === "buyer" && c.status === "SELLER_REVIEWING");
  // Requests the seller turned down in the last 3 days, so the buyer sees it without opening the bell.
  const declined = (contracts ?? []).filter(
    (c) => c.viewerRole === "buyer" && c.status === "REJECTED" && Date.now() - new Date(c.expiresAt).getTime() < 3 * 86400000 + 86400000,
  );

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <TopBar title="Track Deliveries" back="/app" />

      <div className="px-4 sm:px-6 pt-4 pb-8 space-y-3">
        {isLoading && <ListSkeleton rows={3} />}
        {isError && <ErrorState description="Couldn't load your deliveries." onRetry={() => refetch()} />}
        {waiting.map((c) => (
          <div key={c.id} className="rounded-3xl border border-gold/30 bg-gold/5 p-4">
            <p className="text-xs font-bold tracking-[0.15em] text-gold">WAITING FOR SELLER</p>
            <p className="mt-1 font-semibold">{c.itemName}</p>
            <p className="text-xs text-muted-foreground">{formatCurrency(c.amount)} · the seller has until {new Date(c.expiresAt).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })} to confirm</p>
          </div>
        ))}
        {declined.map((c) => (
          <div key={`d${c.id}`} className="rounded-3xl border border-destructive/40 bg-destructive/10 p-4">
            <p className="text-xs font-bold tracking-[0.15em] text-destructive">SELLER DECLINED</p>
            <p className="mt-1 font-semibold">{c.itemName}</p>
            <p className="text-xs text-muted-foreground">{formatCurrency(c.amount)} · No money was taken. You can pick another seller.</p>
          </div>
        ))}
        {!isLoading && !isError && trackable.length === 0 && waiting.length === 0 && declined.length === 0 && (
          <EmptyState icon={Package} title="Nothing in transit" description="Orders on their way to you will show up here." />
        )}

        {!isLoading &&
          !isError &&
          trackable.map((order) => (
            <div key={order.id} className="rounded-3xl border border-border/40 bg-surface p-4 shadow-card">
              <div className="flex items-start gap-3">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-violet">
                  <Package className="h-6 w-6 text-accent-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-semibold">{order.item}</p>
                    <span className="shrink-0 rounded-full border border-gold/30 bg-gold/15 px-2 py-0.5 text-[10px] font-semibold text-gold">
                      {order.status}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {order.seller} · {formatCurrency(order.buyerPays ?? order.amount)}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2 rounded-2xl border border-gold/30 bg-gold/5 p-3">
                <Shield className="h-4 w-4 shrink-0 text-gold" />
                <p className="text-[11px] leading-relaxed text-muted-foreground">Funds stay protected in escrow until you confirm delivery.</p>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <Link
                  to="/app/tracking/$id"
                  params={{ id: order.id }}
                  className="flex h-10 items-center justify-center gap-1.5 rounded-2xl bg-gradient-gold text-xs font-semibold text-gold-foreground shadow-gold"
                >
                  View Details
                </Link>
                <button
                  type="button"
                  onClick={() => toast.info("In-app messaging is coming soon.")}
                  className="flex h-10 items-center justify-center gap-1.5 rounded-2xl border border-border bg-surface text-xs font-semibold transition-colors hover:bg-surface-2"
                >
                  <MessageCircle className="h-3.5 w-3.5" /> Contact
                </button>
                <Link
                  to="/app/disputes"
                  className="flex h-10 items-center justify-center gap-1.5 rounded-2xl border border-destructive/30 bg-destructive/10 text-xs font-semibold text-destructive"
                >
                  <AlertCircle className="h-3.5 w-3.5" /> Report
                </Link>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
