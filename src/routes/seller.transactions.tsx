import { createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight, ArrowDownRight, Download } from "lucide-react";
import { toast } from "sonner";
import { TopBar } from "@/components/zuno/TopBar";
import { KycGate } from "@/components/zuno/KycGate";
import { ErrorState, EmptyState } from "@/components/common/StateViews";
import { currency } from "@/lib/zuno-data";
import { displayDate, parseAnyDate } from "@/lib/api/mappers";
import { exportToCsv } from "@/lib/csv-export";
import { useTransactions } from "@/hooks/queries/useTransactions";
import { Receipt } from "lucide-react";
import type { Transaction } from "@/types/models";

export const Route = createFileRoute("/seller/transactions")({
  head: () => ({ meta: [{ title: "Payouts — ZUNO Seller" }] }),
  component: () => (
    <KycGate fallback="/seller">
      <Payouts />
    </KycGate>
  ),
});

// NOTE: there's no real per-seller account table yet (see auth.service.ts),
// so — same convention as the Buyer dashboard (app.index.tsx) and the
// Admin screens — this treats every mock transaction as belonging to the
// current session rather than inventing a seller-id filter with nothing
// real to filter against.
function Payouts() {
  const { data: transactions, isLoading, isError, refetch } = useTransactions();

  const completed = (transactions ?? []).filter((t) => t.status === "Completed" || t.status === "Resolved");
  const inEscrow = (transactions ?? []).filter((t) => ["Funded", "Protected", "In transit", "Inspection"].includes(t.status));
  const refunded = (transactions ?? []).filter((t) => t.status === "Refunded");

  const mine = (t: Transaction) => t.sellerReceives ?? t.amount;
  const earned = completed.reduce((sum, t) => sum + mine(t), 0);
  const paidOut = completed.filter((t) => t.payoutStatus === "paid").reduce((sum, t) => sum + mine(t), 0);
  const pendingPayout = completed.filter((t) => t.payoutStatus !== "paid").reduce((sum, t) => sum + mine(t), 0) +
    inEscrow.reduce((sum, t) => sum + mine(t), 0);
  const refunds = refunded.reduce((sum, t) => sum + t.amount, 0);

  const history = [...(transactions ?? [])].sort((a, b) => parseDate(b.date) - parseDate(a.date));

  const handleExport = () => {
    try {
      exportToCsv(
        `zuno-payouts-${new Date().toISOString().slice(0, 10)}.csv`,
        history,
        [
          { header: "Item", accessor: (r: Transaction) => r.item },
          { header: "Date", accessor: (r: Transaction) => displayDate(r.date) },
          { header: "Amount (KES)", accessor: (r: Transaction) => r.amount },
          { header: "Status", accessor: (r: Transaction) => r.status },
          { header: "Payout status", accessor: (r: Transaction) => r.payoutStatus ?? "pending" },
        ],
      );
      toast.success("CSV downloaded.");
    } catch {
      toast.error("Couldn't generate the CSV. Please try again.");
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <TopBar title="Revenue & Payouts" />
      <div className="px-4 sm:px-6 pt-4 pb-8">
        {isError ? (
          <ErrorState description="Couldn't load your revenue data." onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-3 h-24 animate-pulse rounded-2xl bg-surface-2" />
            <div className="h-16 animate-pulse rounded-2xl bg-surface-2" />
            <div className="h-16 animate-pulse rounded-2xl bg-surface-2" />
            <div className="h-16 animate-pulse rounded-2xl bg-surface-2" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Tile label="Earned" value={currency(earned)} className="col-span-3 bg-gradient-card border-gold/30" big />
              <Tile label="Payouts" value={currency(paidOut)} />
              <Tile label="Pending" value={currency(pendingPayout)} accent />
              <Tile label="Refunds" value={currency(refunds)} />
            </div>

            <button
              onClick={handleExport}
              disabled={history.length === 0}
              className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-gold text-sm font-semibold text-gold-foreground shadow-gold transition-opacity hover:opacity-95 disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> Export CSV
            </button>

            <p className="mt-6 text-xs font-bold tracking-[0.18em] text-muted-foreground">HISTORY</p>
            {history.length === 0 ? (
              <div className="mt-3">
                <EmptyState icon={Receipt} title="No transactions yet" description="Sales will show up here once buyers pay into escrow." />
              </div>
            ) : (
              <ul className="mt-3 divide-y divide-border/40 overflow-hidden rounded-2xl border border-border/40 bg-surface">
                {history.map((t) => {
                  const isOutflow = t.status === "Refunded";
                  return (
                    <li key={t.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3.5">
                      <span className={`grid h-10 w-10 place-items-center rounded-2xl ${isOutflow ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success"}`}>
                        {isOutflow ? <ArrowDownRight className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">Sale · {t.item}</p>
                        <p className="truncate text-xs text-muted-foreground">{displayDate(t.date)} · {t.status}</p>
                      </div>
                      <p className={`text-sm font-bold ${isOutflow ? "text-destructive" : "text-success"}`}>
                        {isOutflow ? "−" : "+"}{currency(t.amount)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Seed dates are "DD/MM/YYYY" — sort newest first.
function parseDate(d: string): number {
  return parseAnyDate(d).getTime();
}

function Tile({ label, value, className = "", big, accent }: { label: string; value: string; className?: string; big?: boolean; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border border-border/40 bg-surface p-4 ${className}`}>
      <p className="text-[10px] tracking-wider text-muted-foreground">{label.toUpperCase()}</p>
      <p className={`mt-1 font-bold ${big ? "text-3xl" : "text-base"} ${accent ? "text-gold" : ""}`}>{value}</p>
    </div>
  );
}
