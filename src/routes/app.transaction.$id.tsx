import { createFileRoute, Link } from "@tanstack/react-router";
import { Receipt as ReceiptIcon, Shield, Copy, Check, Smartphone } from "lucide-react";
import { VerificationBadge } from "@/components/zuno/VerificationBadge";
import { useState } from "react";
import { toast } from "sonner";
import { TopBar } from "@/components/zuno/TopBar";
import { ReceiptSheet } from "@/components/zuno/ReceiptSheet";
import { ErrorState, CardSkeleton } from "@/components/common/StateViews";
import { useTransaction } from "@/hooks/queries/useTransactions";
import { useSeller } from "@/hooks/queries/useSellers";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency, statusColorClass } from "@/services/transactions.service";
import { displayDate, formatDateNairobi } from "@/lib/api/mappers";
import type { ReceiptData } from "@/lib/receipt";

export const Route = createFileRoute("/app/transaction/$id")({
  head: ({ params }) => ({ meta: [{ title: `Receipt ${params.id} — ZUNO` }] }),
  component: TxDetail,
});

function buildReceiptData(
  tx: NonNullable<ReturnType<typeof useTransaction>["data"]>,
  buyerName?: string,
): ReceiptData {
  const escrowFee = tx.buyerFeeShare ?? 0;
  // tx.date can be a raw ISO timestamp; show a readable Nairobi-time date instead.
  const date = /^\d{4}-\d{2}-\d{2}T/.test(tx.date) ? formatDateNairobi(tx.date, true) : tx.date;
  return {
    id: tx.id,
    kind: "payment",
    dateLabel: date,
    greetingName: buyerName,
    rows: [
      { label: "Date", value: date },
      { label: "Seller", value: tx.seller },
      { label: "Item", value: tx.item },
      { label: "Category", value: tx.category },
      { label: "Payment method", value: "M-PESA" },
      { label: "Escrow fee", value: formatCurrency(escrowFee) },
    ],
    totalLabel: "Total paid",
    totalValue: formatCurrency(tx.buyerPays ?? tx.amount),
    note: "This is a receipt of payment into ZUNO escrow, not proof of delivery. Funds are released to the seller only after delivery is confirmed.",
  };
}

function TxDetail() {
  const { id } = Route.useParams();
  const { data: tx, isLoading, isError, refetch } = useTransaction(id);
  const { data: seller } = useSeller(tx?.sellerId);
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);

  const handleCopyId = async () => {
    if (!tx) return;
    try {
      await navigator.clipboard.writeText(tx.id);
      setCopied(true);
      toast.success("Transaction ID copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — select and copy manually.");
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col overflow-y-auto">
        <TopBar title="Receipt" back="/app/transactions" />
        <div className="space-y-4 px-4 sm:px-6 pt-4">
          <CardSkeleton className="h-40" />
          <CardSkeleton className="h-32" />
          <CardSkeleton className="h-20" />
        </div>
      </div>
    );
  }

  if (isError || !tx) {
    return (
      <div className="flex flex-1 flex-col overflow-y-auto">
        <TopBar title="Receipt" back="/app/transactions" />
        <div className="px-4 sm:px-6 pt-6">
          <ErrorState
            title="Transaction not found"
            description="This receipt may have moved or doesn't exist."
            onRetry={() => refetch()}
          />
          <Link
            to="/app/transactions"
            className="mt-4 block text-center text-sm font-medium text-gold"
          >
            Back to Activity
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <TopBar title="Receipt" back="/app/transactions" />

      <div className="px-4 sm:px-6 pt-4">
        <div className="overflow-hidden rounded-3xl border border-border/40 bg-gradient-card p-6 shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold tracking-[0.18em] text-muted-foreground">
              TOTAL PAID
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusColorClass(tx.status)}`}
            >
              {tx.status}
            </span>
          </div>
          <p className="mt-3 text-4xl font-bold">{formatCurrency(tx.buyerPays ?? tx.amount)}</p>
          <div className="mt-4 flex items-center gap-2 rounded-2xl border border-accent/30 bg-accent/10 px-3 py-2">
            <Shield className="h-4 w-4 text-accent" />
            <p className="text-xs font-medium text-accent">Protected by ZUNO</p>
          </div>
        </div>

        <p className="mt-6 px-1 text-xs font-bold tracking-[0.18em] text-muted-foreground">
          PAYMENT INFORMATION
        </p>
        <dl className="mt-2 space-y-3 rounded-2xl border border-border/40 bg-surface p-4 text-sm">
          <Row label="Transaction ID" value={`#${tx.id}`} mono>
            <button
              onClick={handleCopyId}
              aria-label="Copy transaction ID"
              className="text-muted-foreground transition-colors hover:text-gold"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </Row>
          <Row label="Date" value={displayDate(tx.date)} />
          <Row label="Method" value="M-PESA · +254 714 637 437" />
          <Row label="Escrow fee (your half)" value={formatCurrency(tx.buyerFeeShare ?? 0)} />
          <Row label="Category" value={tx.category} />
        </dl>

        <p className="mt-6 px-1 text-xs font-bold tracking-[0.18em] text-muted-foreground">
          SELLER
        </p>
        <Link
          to="/app/seller/$id"
          params={{ id: tx.sellerId }}
          className="mt-2 flex items-center gap-3 rounded-2xl border border-border/40 bg-surface p-4 transition-colors hover:border-gold/30"
        >
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-violet font-bold">
            {seller?.initials ?? tx.seller.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-1.5">
              <p className="font-semibold">{tx.seller}</p>
              {seller && <VerificationBadge seller={seller} />}
            </div>
            <p className="text-xs text-muted-foreground">
              {seller ? `Trusted seller · ${seller.rating} ★` : "View seller profile"}
            </p>
          </div>
        </Link>

        <p className="mt-6 px-1 text-xs font-bold tracking-[0.18em] text-muted-foreground">ITEM</p>
        <div className="mt-2 flex items-center gap-3 rounded-2xl border border-border/40 bg-surface p-4">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-muted-foreground">
            <Smartphone className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <p className="font-semibold">{tx.item}</p>
            <p className="text-xs text-muted-foreground">{tx.category}</p>
          </div>
        </div>

        {(tx.status === "Pending" || tx.status === "Funded" || tx.status === "Protected") && (
          <Link
            to="/app/tracking/$id"
            params={{ id: tx.id }}
            className="mt-4 flex h-12 w-full items-center justify-center rounded-2xl border border-border bg-surface text-sm font-semibold transition-colors hover:bg-surface-2"
          >
            Track this order
          </Link>
        )}

        <button
          onClick={() => setShowReceipt(true)}
          className="my-6 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-gold text-sm font-semibold text-gold-foreground shadow-gold transition-opacity hover:opacity-95"
        >
          <ReceiptIcon className="h-4 w-4" /> Receipt
        </button>
      </div>

      {showReceipt && (
        <ReceiptSheet
          data={buildReceiptData(tx, user?.name)}
          onClose={() => setShowReceipt(false)}
        />
      )}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  children,
}: {
  label: string;
  value: string;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-2">
        <span className={`text-right font-medium ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
        {children}
      </dd>
    </div>
  );
}
