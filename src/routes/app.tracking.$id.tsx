import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Shield, AlertCircle, Loader2, Clock, Star } from "lucide-react";
import { toast } from "sonner";
import { TopBar } from "@/components/zuno/TopBar";
import { CardSkeleton, ErrorState } from "@/components/common/StateViews";
import {
  useApproveTransaction,
  useCancelTransaction,
  useConfirmDelivery,
  useTransaction,
} from "@/hooks/queries/useTransactions";
import { formatCurrency, statusColorClass } from "@/services/transactions.service";
import { formatDateNairobi } from "@/lib/api/mappers";
import type { Transaction, TxStatus } from "@/types/models";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/app/tracking/$id")({
  head: ({ params }) => ({ meta: [{ title: `Order ${params.id} — ZUNO` }] }),
  component: Tracking,
});

const ORDER: TxStatus[] = ["Pending", "Funded", "In transit", "Inspection", "Completed"];

function stepsFor(status: TxStatus) {
  const at = ORDER.indexOf(status === "Protected" ? "Funded" : status);
  const reached = (s: TxStatus) => at >= ORDER.indexOf(s);
  return [
    { title: "Payment secured by ZUNO", done: reached("Funded"), active: status === "Pending" },
    { title: "Seller prepares and ships", done: reached("In transit"), active: status === "Funded" },
    { title: "Item delivered to you", done: reached("Inspection"), active: status === "In transit" },
    { title: "You inspect and approve", done: status === "Completed", active: status === "Inspection" },
    { title: "Funds released to the seller", done: status === "Completed" },
  ];
}

function useCountdown(endIso?: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endIso) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [endIso]);
  if (!endIso) return null;
  const ms = new Date(endIso).getTime() - now;
  if (ms <= 0) return "Inspection window ended — funds are being released.";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m left to inspect before funds are released automatically`;
}

function Tracking() {
  const { id } = Route.useParams();
  const { data: tx, isLoading, isError, refetch } = useTransaction(id);

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col overflow-y-auto">
        <TopBar title="Order Tracking" back="/app" />
        <div className="space-y-4 px-4 sm:px-6 pt-4">
          <CardSkeleton className="h-36" />
          <CardSkeleton className="h-48" />
        </div>
      </div>
    );
  }

  if (isError || !tx) {
    return (
      <div className="flex flex-1 flex-col overflow-y-auto">
        <TopBar title="Order Tracking" back="/app" />
        <div className="px-4 sm:px-6 pt-6">
          <ErrorState title="Order not found" description="We couldn't find this order." onRetry={() => refetch()} />
        </div>
      </div>
    );
  }
  return <TrackingBody tx={tx} />;
}

function TrackingBody({ tx }: { tx: Transaction }) {
  const confirmDelivery = useConfirmDelivery();
  const approve = useApproveTransaction();
  const cancel = useCancelTransaction();
  const countdown = useCountdown(tx.status === "Inspection" ? tx.inspectionEndsAt : undefined);
  const [score, setScore] = useState(5);
  const steps = stepsFor(tx.status);
  const total = tx.buyerPays ?? tx.amount;

  const run = (p: Promise<unknown>, ok: string) =>
    p.then(() => toast.success(ok)).catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Something went wrong."));

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <TopBar title="Order Tracking" back="/app" />

      <div className="px-4 sm:px-6 pt-4">
        <div className="flex items-center justify-between">
          <p className="font-mono text-base font-bold tracking-tight">#{tx.id}</p>
          <span className={`rounded-full border px-3 py-1 text-[10px] font-semibold ${statusColorClass(tx.status)}`}>{tx.status}</span>
        </div>

        <div className="mt-4 overflow-hidden rounded-3xl border border-accent/30 bg-gradient-violet/40 p-5 shadow-card">
          <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground">
            {tx.status === "Pending" ? "TO PAY" : "TOTAL PAID"}
          </p>
          <p className="mt-2 text-4xl font-bold">{formatCurrency(total)}</p>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border/40 pt-3 text-sm">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Item</p>
              <p className="mt-0.5 font-semibold">{tx.item}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Seller</p>
              <p className="mt-0.5 font-semibold">{tx.seller}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Item price</p>
              <p className="mt-0.5 font-semibold">{formatCurrency(tx.amount)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Your share of the fee</p>
              <p className="mt-0.5 font-semibold">{formatCurrency(tx.buyerFeeShare ?? 0)}</p>
            </div>
          </div>
          {(tx.trackingNumber || tx.courierName) && (
            <p className="mt-3 border-t border-border/40 pt-3 text-xs text-muted-foreground">
              {tx.courierName ?? "Courier"} · Tracking: <span className="font-mono text-foreground">{tx.trackingNumber ?? "—"}</span>
            </p>
          )}
          {tx.mpesaReference && (
            <p className="mt-1 text-xs text-muted-foreground">
              M-Pesa receipt: <span className="font-mono text-foreground">{tx.mpesaReference}</span>
            </p>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">Created {formatDateNairobi(tx.date, true)}</p>
        </div>

        <p className="mt-6 text-xs font-bold tracking-[0.18em] text-muted-foreground">PROGRESS</p>
        <ol className="mt-3 space-y-0">
          {steps.map((s, i) => (
            <li key={i} className="grid grid-cols-[auto_1fr] gap-4">
              <div className="flex flex-col items-center">
                <div
                  className={`grid h-10 w-10 place-items-center rounded-full text-xs font-bold ${
                    s.done ? "bg-accent text-accent-foreground" : s.active ? "border-2 border-gold bg-gold/15 text-gold" : "border-2 border-border bg-surface text-muted-foreground"
                  }`}
                >
                  {s.done ? <Check className="h-4 w-4" /> : i + 1}
                </div>
                {i < steps.length - 1 && <div className={`h-12 w-0.5 ${s.done ? "bg-accent" : "bg-border"}`} />}
              </div>
              <div className="pb-6 pt-1.5">
                <p className={`text-sm font-semibold ${s.done || s.active ? "text-foreground" : "text-muted-foreground"}`}>{s.title}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-2 flex items-center gap-2 rounded-2xl border border-gold/30 bg-gold/5 p-3">
          <Shield className="h-4 w-4 shrink-0 text-gold" />
          <p className="text-xs text-muted-foreground">
            Your money stays with ZUNO until you approve the item, or the inspection window ends with no problem reported.
          </p>
        </div>

        {countdown && (
          <div className="mt-3 flex items-center gap-2 rounded-2xl border border-accent/30 bg-accent/10 p-3 text-xs">
            <Clock className="h-4 w-4 text-accent" /> {countdown}
          </div>
        )}

        {tx.status === "Pending" && (
          <Link
            to="/app/pay"
            search={{ tx: tx.id } as never}
            className="mt-4 flex h-12 w-full items-center justify-center rounded-2xl bg-gradient-gold text-sm font-semibold text-gold-foreground shadow-gold"
          >
            Pay {formatCurrency(total)} with M-Pesa
          </Link>
        )}

        {tx.status === "In transit" && (
          <button
            disabled={confirmDelivery.isPending}
            onClick={() => run(confirmDelivery.mutateAsync(tx.id), "Delivery confirmed. Your inspection window has started.")}
            className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-gold text-sm font-semibold text-gold-foreground shadow-gold disabled:opacity-60"
          >
            {confirmDelivery.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            I received my item
          </button>
        )}

        {tx.status === "Inspection" && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                disabled={approve.isPending}
                className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-gold text-sm font-semibold text-gold-foreground shadow-gold disabled:opacity-60"
              >
                {approve.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Approve & release funds
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Release the payment?</AlertDialogTitle>
                <AlertDialogDescription>
                  This sends {formatCurrency(tx.sellerReceives ?? tx.amount)} to {tx.seller}. Only approve once you have checked "{tx.item}"
                  and it matches what you agreed. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="flex items-center justify-center gap-1" role="radiogroup" aria-label="Rate the seller">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={score === n} onClick={() => setScore(n)} aria-label={`${n} stars`}>
                    <Star className={`h-7 w-7 ${n <= score ? "fill-gold text-gold" : "text-muted-foreground"}`} />
                  </button>
                ))}
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Not yet</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => run(approve.mutateAsync({ id: tx.id, rating: { score } }), "Funds released to the seller. Thank you!")}
                >
                  Yes, release funds
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3 pb-8">
          {["Funded", "In transit", "Inspection", "Disputed"].includes(tx.status) ? (
            <Link
              to="/app/disputes"
              search={{ tx: tx.id } as never}
              className="col-span-2 flex h-12 items-center justify-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/15"
            >
              <AlertCircle className="h-4 w-4" /> {tx.status === "Disputed" ? "Open the dispute" : "Report a problem"}
            </Link>
          ) : null}
          {tx.status === "Pending" && (
            <button
              disabled={cancel.isPending}
              onClick={() => run(cancel.mutateAsync({ id: tx.id }), "Order cancelled.")}
              className="col-span-2 flex h-12 items-center justify-center rounded-2xl border border-border bg-surface text-sm font-semibold"
            >
              Cancel this order
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
