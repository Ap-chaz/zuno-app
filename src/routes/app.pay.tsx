import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Shield, AlertTriangle, Lock, Phone, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { TopBar } from "@/components/zuno/TopBar";
import { KycGate } from "@/components/zuno/KycGate";
import { CardSkeleton, ErrorState } from "@/components/common/StateViews";
import { useAuth } from "@/hooks/useAuth";
import { useTransaction } from "@/hooks/queries/useTransactions";
import { formatCurrency, transactionsService } from "@/services/transactions.service";

type PaySearch = { tx?: string };

export const Route = createFileRoute("/app/pay")({
  head: () => ({ meta: [{ title: "Secure Payment — ZUNO" }] }),
  validateSearch: (s: Record<string, unknown>): PaySearch => ({ tx: typeof s.tx === "string" ? s.tx : undefined }),
  component: () => (
    <KycGate fallback="/app">
      <PayPage />
    </KycGate>
  ),
});

const POLL_MS = 4000;
const GIVE_UP_MS = 120_000;

type Phase = "form" | "waiting" | "paid" | "failed";

function PayPage() {
  const { tx: txId } = Route.useSearch();
  const { data: tx, isLoading, isError, refetch } = useTransaction(txId);
  const navigate = useNavigate();
  const { user } = useAuth();
  const [phone, setPhone] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (user?.phone && !phone) setPhone(user.phone);
  }, [user, phone]);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  if (!txId) {
    return (
      <div className="flex flex-1 flex-col">
        <TopBar title="Secure Payment" back="/app" />
        <div className="px-4 sm:px-6 pt-6">
          <ErrorState title="Nothing to pay" description="Open a pending order and tap Pay." />
        </div>
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col"><TopBar title="Secure Payment" back="/app" />
        <div className="space-y-3 px-4 sm:px-6 pt-4"><CardSkeleton className="h-48" /></div></div>
    );
  }
  if (isError || !tx) {
    return (
      <div className="flex flex-1 flex-col"><TopBar title="Secure Payment" back="/app" />
        <div className="px-4 sm:px-6 pt-6"><ErrorState title="Order not found" description="We couldn't load this order." onRetry={() => refetch()} /></div></div>
    );
  }

  const total = tx.buyerPays ?? tx.amount;
  const alreadyPaid = tx.status !== "Pending";

  const startPolling = () => {
    const started = Date.now();
    setPhase("waiting");
    timer.current = setInterval(async () => {
      try {
        const s = await transactionsService.paymentStatus(tx.id);
        if (s.funded) {
          if (timer.current) clearInterval(timer.current);
          setPhase("paid");
          setMessage(s.mpesaReference ?? null);
          return;
        }
        if (s.lastFailure) {
          if (timer.current) clearInterval(timer.current);
          setPhase("failed");
          setMessage(`M-Pesa said: ${s.lastFailure}. Check the number and try again.`);
          return;
        }
      } catch {
        /* keep polling; transient network errors are fine */
      }
      if (Date.now() - started > GIVE_UP_MS) {
        if (timer.current) clearInterval(timer.current);
        setPhase("failed");
        setMessage("We didn't get a payment confirmation. If M-Pesa took your money, it will appear here shortly; otherwise try again.");
      }
    }, POLL_MS);
  };

  const handlePay = async () => {
    setMessage(null);
    try {
      await transactionsService.pay(tx.id, phone);
      toast.info("Check your phone and enter your M-Pesa PIN.");
      startPolling();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Payment couldn't be started. Please try again.");
    }
  };

  if (phase === "paid" || alreadyPaid) {
    return (
      <div className="flex flex-1 flex-col">
        <TopBar title="Payment" back="/app" />
        <div className="flex flex-1 flex-col items-center px-6 pt-16 text-center">
          <CheckCircle2 className="h-16 w-16 text-success" />
          <h1 className="mt-4 text-2xl font-bold">{phase === "paid" ? "Payment received" : "Already paid"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {formatCurrency(total)} is held safely by ZUNO until you approve the item.
          </p>
          {message && <p className="mt-2 font-mono text-xs text-muted-foreground">M-Pesa receipt {message}</p>}
          <button
            onClick={() => navigate({ to: "/app/tracking/$id", params: { id: tx.id } })}
            className="mt-8 flex h-12 w-full max-w-xs items-center justify-center rounded-2xl bg-gradient-gold text-sm font-semibold text-gold-foreground shadow-gold"
          >
            Track my order
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <TopBar title="Secure Payment" back="/app" />
      <div className="px-4 sm:px-6 pt-4">
        <h1 className="text-2xl font-bold">Confirm & Pay</h1>

        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-accent/30 bg-accent/10 px-4 py-3">
          <Shield className="h-4 w-4 text-accent" />
          <p className="text-xs font-medium text-accent">Funds locked in ZUNO escrow until you approve the item</p>
        </div>

        <dl className="mt-5 space-y-3 rounded-2xl border border-border/40 bg-surface p-4 text-sm">
          <Line label="Item" value={tx.item} />
          <Line label="Seller" value={tx.seller} />
          <Line label="Item price" value={formatCurrency(tx.amount)} />
          <Line label="Escrow fee (your half)" value={formatCurrency(tx.buyerFeeShare ?? total - tx.amount)} />
          <div className="my-1 h-px bg-border/60" />
          <Line label="Total" value={formatCurrency(total)} bold />
        </dl>

        <p className="mt-6 text-xs font-bold tracking-[0.18em] text-accent">PAY WITH M-PESA</p>
        <div className="mt-3 flex items-center gap-3 rounded-2xl border border-border/60 bg-input px-4 py-3">
          <Phone className="h-4 w-4 text-gold" />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            placeholder="07XX XXX XXX"
            disabled={phase === "waiting"}
            className="flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        <p className="mt-1 px-1 text-[11px] text-muted-foreground">The M-Pesa PIN prompt goes to this number.</p>

        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-gold/30 bg-gold/10 px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-gold" />
          <p className="text-xs text-gold/90">If a seller asks you to send money directly, stop. That's a scam.</p>
        </div>

        {phase === "failed" && message && (
          <div className="mt-4 flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3">
            <XCircle className="h-4 w-4 shrink-0 text-destructive" />
            <p className="text-xs text-destructive">{message}</p>
          </div>
        )}

        <button
          onClick={handlePay}
          disabled={phase === "waiting" || !phone.trim()}
          className="my-6 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-gold text-base font-semibold text-gold-foreground shadow-gold transition-opacity disabled:opacity-60"
        >
          {phase === "waiting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
          {phase === "waiting" ? "Waiting for M-Pesa…" : `Pay ${formatCurrency(total)} into Escrow`}
        </button>
      </div>
    </div>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className={bold ? "font-semibold" : "text-muted-foreground"}>{label}</dt>
      <dd className={`text-right ${bold ? "text-lg font-bold" : "font-medium"}`}>{value}</dd>
    </div>
  );
}
