import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Phone,
  Truck,
  Package,
  Clock,
  Receipt as ReceiptIcon,
} from "lucide-react";
import { toast } from "sonner";
import { TopBar } from "@/components/zuno/TopBar";
import { ReceiptSheet } from "@/components/zuno/ReceiptSheet";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/StateViews";
import { currency } from "@/lib/zuno-data";
import { KycRequiredDialog } from "@/components/zuno/KycRequiredDialog";
import { isKycVerified } from "@/lib/zuno-kyc";
import { useShipTransaction, useTransactions } from "@/hooks/queries/useTransactions";
import { formatDateNairobi } from "@/lib/api/mappers";
import { useAuth } from "@/hooks/useAuth";
import type { ReceiptData } from "@/lib/receipt";
import type { Transaction } from "@/types/models";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/seller/deliveries")({
  head: () => ({ meta: [{ title: "Delivery Management — ZUNO" }] }),
  component: Deliveries,
});

const tabs = ["Waiting", "Active", "Completed"] as const;
type Tab = (typeof tabs)[number];

// Waiting = paid into escrow but not yet marked shipped (status "Funded").
// Active = marked shipped / in transit (status "Protected" — the same
// status app.tracking.$id.tsx labels "In transit" on the buyer side).
// Completed = delivery confirmed, escrow released (status "Completed").
// NOTE: same convention as the rest of the Seller module — there's no
// real per-seller account table yet, so this shows every mock transaction
// in the relevant status rather than inventing a seller-id filter.
const STATUSES_FOR_TAB: Record<Tab, Transaction["status"][]> = {
  Waiting: ["Funded"],
  Active: ["Protected", "In transit", "Inspection", "Disputed"],
  Completed: ["Completed", "Resolved"],
};

function Deliveries() {
  const { data: transactions, isLoading, isError, refetch } = useTransactions();
  const ship = useShipTransaction();
  const { user } = useAuth();
  const [shipOrder, setShipOrder] = useState<Transaction | null>(null);
  const [tracking, setTracking] = useState({ courier: "", number: "", notes: "" });

  const [tab, setTab] = useState<Tab>("Waiting");
  const [detailsOrder, setDetailsOrder] = useState<Transaction | null>(null);
  const [receiptOrder, setReceiptOrder] = useState<Transaction | null>(null);
  const [kycOpen, setKycOpen] = useState(false);

  const byTab = useMemo(() => {
    const buckets: Record<Tab, Transaction[]> = { Waiting: [], Active: [], Completed: [] };
    for (const t of transactions ?? []) {
      const tabForStatus = (Object.keys(STATUSES_FOR_TAB) as Tab[]).find((k) => STATUSES_FOR_TAB[k].includes(t.status));
      if (tabForStatus) buckets[tabForStatus].push(t);
    }
    return buckets;
  }, [transactions]);

  const openShip = (order: Transaction) => {
    // The API refuses shipping for unverified sellers too; this just explains why up front.
    if (!isKycVerified()) {
      setKycOpen(true);
      return;
    }
    setTracking({ courier: "", number: "", notes: "" });
    setShipOrder(order);
  };

  const submitShip = () => {
    if (!shipOrder) return;
    if (!tracking.number.trim()) {
      toast.error("Enter a tracking or waybill number so the buyer can follow the parcel.");
      return;
    }
    ship.mutate(
      { id: shipOrder.id, trackingNumber: tracking.number.trim(), courierName: tracking.courier.trim() || undefined, notes: tracking.notes.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(`${shipOrder.item} marked as shipped. The buyer has been notified.`);
          setShipOrder(null);
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't update this order."),
      },
    );
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <TopBar title="Delivery Management" />

      <div className="mx-5 mt-4 grid grid-cols-3 gap-1 rounded-2xl border border-border/40 bg-surface p-1">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
              tab === t ? "bg-gradient-gold text-gold-foreground" : "text-muted-foreground"
            }`}
          >
            {t} <span className="opacity-60">({byTab[t].length})</span>
          </button>
        ))}
      </div>

      <div className="mt-4 px-4 sm:px-6 pb-8">
        {isError ? (
          <ErrorState description="Couldn't load your orders." onRetry={() => refetch()} />
        ) : isLoading ? (
          <ListSkeleton rows={3} />
        ) : byTab[tab].length === 0 ? (
          <EmptyState
            icon={Package}
            title={`No ${tab.toLowerCase()} orders`}
            description="Orders will appear here as buyers place them."
          />
        ) : (
          <ul className="space-y-3">
            {byTab[tab].map((o) => (
              <li key={o.id} className="rounded-3xl border border-border/40 bg-surface p-4">
                <div className="flex items-start gap-3">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-surface-2 text-muted-foreground">
                    <Package className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{o.item}</p>
                    <p className="truncate text-xs text-muted-foreground">Buyer: {o.buyerName ?? "Unknown buyer"}</p>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                      #{o.id}
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <Action
                    icon={Phone}
                    label="Call"
                    onClick={() => toast.info("Buyer calling is coming soon.")}
                  />
                  {tab === "Waiting" && (
                    <Action
                      icon={Truck}
                      label="Mark shipped"
                      gold
                      disabled={ship.isPending}
                      onClick={() => openShip(o)}
                    />
                  )}
                  {tab === "Active" && (
                    <div className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/60 text-xs font-medium text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" /> {o.status === "Inspection" ? "Buyer inspecting" : o.status === "Disputed" ? "In dispute" : "Awaiting buyer"}
                    </div>
                  )}
                  {tab === "Completed" && (
                    <Action
                      icon={ReceiptIcon}
                      label="Receipt"
                      gold
                      onClick={() => setReceiptOrder(o)}
                    />
                  )}
                  <Action icon={Package} label="Details" onClick={() => setDetailsOrder(o)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={detailsOrder !== null} onOpenChange={(open) => !open && setDetailsOrder(null)}>
        <DialogContent>
          {detailsOrder && (
            <>
              <DialogHeader>
                <DialogTitle>{detailsOrder.item}</DialogTitle>
                <DialogDescription className="font-mono text-xs">
                  #{detailsOrder.id}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="rounded-2xl border border-border/40 bg-surface-2 p-4">
                  <p className="text-xs text-muted-foreground">Escrow amount</p>
                  <p className="mt-1 text-2xl font-bold">{currency(detailsOrder.buyerPays ?? detailsOrder.amount)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">You receive {currency(detailsOrder.sellerReceives ?? detailsOrder.amount)} after the ZUNO fee.</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Held safely until the buyer confirms delivery — released to you the moment they
                    do.
                  </p>
                </div>
                <Detail icon={Package} label="Buyer" value={detailsOrder.buyerName ?? "Unknown buyer"} />
                <Detail icon={Clock} label="Order placed" value={formatDateNairobi(detailsOrder.date, true)} />
                <Detail icon={Truck} label="Status" value={detailsOrder.status} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={shipOrder !== null} onOpenChange={(open) => !open && setShipOrder(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as shipped</DialogTitle>
            <DialogDescription>
              {shipOrder?.item}. The buyer gets an SMS with these details.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <input
              value={tracking.courier}
              onChange={(e) => setTracking((t) => ({ ...t, courier: e.target.value }))}
              placeholder="Courier (e.g. Wells Fargo, Fargo Courier)"
              className="h-12 w-full rounded-2xl border border-border/60 bg-input px-4 text-sm outline-none focus:border-gold/50"
            />
            <input
              value={tracking.number}
              onChange={(e) => setTracking((t) => ({ ...t, number: e.target.value }))}
              placeholder="Tracking / waybill number"
              className="h-12 w-full rounded-2xl border border-border/60 bg-input px-4 text-sm outline-none focus:border-gold/50"
            />
            <textarea
              value={tracking.notes}
              onChange={(e) => setTracking((t) => ({ ...t, notes: e.target.value }))}
              placeholder="Notes for the buyer (optional)"
              rows={2}
              className="w-full rounded-2xl border border-border/60 bg-input px-4 py-3 text-sm outline-none focus:border-gold/50"
            />
            <button
              onClick={submitShip}
              disabled={ship.isPending}
              className="flex h-12 w-full items-center justify-center rounded-2xl bg-gradient-gold text-sm font-semibold text-gold-foreground shadow-gold disabled:opacity-60"
            >
              {ship.isPending ? "Saving…" : "Confirm shipped"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <KycRequiredDialog
        open={kycOpen}
        onOpenChange={setKycOpen}
        title="Verify your identity to continue"
        description="Sellers must complete identity verification (KYC) before shipping orders or receiving payouts. It only takes a few minutes and you only do it once."
      />

      {receiptOrder && (
        <ReceiptSheet data={buildReceiptData(receiptOrder)} onClose={() => setReceiptOrder(null)} />
      )}
    </div>
  );
}

function buildReceiptData(order: Transaction): ReceiptData {
  // All amounts come from the API (calculated server-side); nothing is recomputed here.
  const date = formatDateNairobi(order.date, true);
  const sellerFee = order.sellerFeeShare ?? 0;
  const payout = order.sellerReceives ?? order.amount - sellerFee;

  return {
    id: order.id,
    kind: "payout",
    dateLabel: date,
    rows: [
      { label: "Date", value: date },
      { label: "Buyer", value: order.buyerName ?? "Unknown buyer" },
      { label: "Item", value: order.item },
      { label: "Item price", value: currency(order.amount) },
      { label: "ZUNO fee (your share)", value: `-${currency(sellerFee)}` },
      ...(order.mpesaReference ? [{ label: "M-Pesa receipt", value: order.mpesaReference }] : []),
    ],
    totalLabel: "Paid out to you",
    totalValue: currency(payout),
  };
}

function Detail({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Package;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/40 px-3 py-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-semibold">{value}</p>
      </div>
    </div>
  );
}

function Action({
  icon: Icon,
  label,
  gold,
  disabled,
  onClick,
}: {
  icon: typeof Phone;
  label: string;
  gold?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex h-10 items-center justify-center gap-1.5 rounded-xl text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-50 ${
        gold
          ? "bg-gradient-gold text-gold-foreground"
          : "border border-border bg-surface-2 text-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}
