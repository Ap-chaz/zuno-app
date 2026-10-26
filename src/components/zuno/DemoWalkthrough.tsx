import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft, ShieldCheck, Check, CheckCircle2, Circle, ChevronRight,
  Clock, Smartphone, Truck, PackageCheck, Send, Wallet, Loader2,
} from "lucide-react";
import { currency } from "@/lib/zuno-data";
import { ThemeToggle } from "@/components/zuno/ThemeToggle";

/**
 * Passive, watch-only walkthrough of the REAL ZUNO deal process. Nothing here
 * calls the API or writes anything. Keep it in step with the real flow:
 *   1. Buyer sends a written request        (NewDealRequest)
 *   2. Seller confirms within 48 hours      (contracts)
 *   3. Seller sends the payment request     (transactions/create)
 *   4. Buyer pays by M-Pesa STK push        (payments)
 *   5. Seller ships, item is delivered
 *   6. 24-hour inspection window, buyer approves (or it auto-releases)
 *   7. Seller is paid by M-Pesa
 */

// Shared content width: narrow column on phones, wider on tablets,
// two columns (steps + process tracker) on desktop.
const WRAP = "mx-auto w-full max-w-md sm:max-w-xl lg:max-w-5xl";

const AMOUNT = 191311;
const FEE_PERCENT = 2.5;

// Same rounding as the API's calculate_fees().
function quote(amount: number) {
  const totalFee = Math.floor((amount * FEE_PERCENT) / 100 + 0.5);
  const buyerShare = Math.ceil(totalFee / 2);
  const sellerShare = totalFee - buyerShare;
  return { totalFee, buyerShare, sellerShare, buyerPays: amount + buyerShare, sellerReceives: amount - sellerShare };
}

const STAGES = [
  { label: "Buyer sends request", ms: 6500 },
  { label: "Seller confirms", ms: 6500 },
  { label: "Seller requests payment", ms: 5500 },
  { label: "Buyer pays by M-Pesa", ms: 8000 },
  { label: "Seller ships", ms: 6000 },
  { label: "Inspection window", ms: 6500 },
  { label: "Seller is paid", ms: 6500 },
] as const;

export function DemoWalkthrough({ onRestart }: { onRestart: () => void }) {
  const navigate = useNavigate();
  const [stage, setStage] = useState(0);
  const [beat, setBeat] = useState(0); // 0 = first half of a stage, 1 = second half
  const done = stage >= STAGES.length;
  const q = quote(AMOUNT);

  useEffect(() => {
    if (done) return;
    setBeat(0);
    const ms = STAGES[stage].ms;
    const t1 = setTimeout(() => setBeat(1), Math.round(ms * 0.45));
    const t2 = setTimeout(() => setStage((s) => s + 1), ms);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [stage, done]);

  const back = () => navigate({ to: "/app" });

  return (
    <div className="flex-1 overflow-y-auto pb-8">
      <header className="sticky top-0 z-10 border-b border-border/40 bg-background/85 px-4 pb-4 pt-6 backdrop-blur sm:px-6">
        <div className={`${WRAP} flex items-center gap-3`}>
          <button onClick={back} aria-label="Back" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface transition-colors hover:bg-surface-2">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Demo · {done ? "Complete" : `Step ${stage + 1} of ${STAGES.length}`}
            </p>
            <h1 className="truncate text-base font-bold lg:text-lg">{done ? "Deal complete" : STAGES[stage].label}</h1>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <div className="px-4 pt-4 sm:px-6">
        <div className={`${WRAP} flex h-1.5 overflow-hidden rounded-full bg-surface`}>
          <div
            className="h-full rounded-full bg-gradient-to-r from-gold to-gold/70 transition-all duration-700"
            style={{ width: `${(Math.min(stage + (done ? 0 : 1), STAGES.length) / STAGES.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="px-4 pt-5 sm:px-6">
       <div className={`${WRAP} grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-6`}>
        <div className="min-w-0">
        <Banner text="This is a demo. Nothing is charged and no real deal is created." />

        {stage === 0 && <RequestCard q={q} />}

        {stage === 1 && (
          <StatusCard
            icon={beat ? <Check className="h-10 w-10 text-gold" /> : <Clock className="h-10 w-10 animate-pulse text-gold" />}
            title={beat ? "Seller confirmed in writing" : "Waiting for the seller"}
            body={
              beat
                ? "Gadget World agreed to your terms. Nothing has been paid yet."
                : "The seller has 48 hours to confirm your terms in writing, or decline."
            }
            chip={beat ? "Terms agreed" : "Awaiting response"}
          />
        )}

        {stage === 2 && (
          <StatusCard
            icon={<Send className="h-10 w-10 text-gold" />}
            title="Seller sent a payment request"
            body="You pay only now, and only after the seller agreed to your terms."
            chip={`You pay ${currency(q.buyerPays)}`}
          >
            <Breakdown q={q} />
          </StatusCard>
        )}

        {stage === 3 && (
          <StatusCard
            icon={
              beat ? (
                <ShieldCheck className="h-10 w-10 text-gold" />
              ) : (
                <Smartphone className="h-10 w-10 animate-pulse text-gold" />
              )
            }
            title={beat ? "Payment received. Funds held in escrow" : "Check your phone"}
            body={
              beat
                ? "The seller cannot touch the money until you approve the delivery."
                : `An M-Pesa prompt for ${currency(q.buyerPays)} is on your phone. Enter your PIN to pay.`
            }
            chip={beat ? "Funds secured" : "M-Pesa STK push"}
          />
        )}

        {stage === 4 && (
          <StatusCard
            icon={beat ? <PackageCheck className="h-10 w-10 text-gold" /> : <Truck className="h-10 w-10 text-gold" />}
            title={beat ? "Delivered" : "Seller is shipping your item"}
            body={
              beat
                ? "Your item arrived. Your inspection window has started."
                : "The seller ships using the delivery method you agreed on."
            }
            chip={beat ? "Delivered" : "In transit"}
          />
        )}

        {stage === 5 && (
          <StatusCard
            icon={beat ? <Check className="h-10 w-10 text-gold" /> : <Clock className="h-10 w-10 text-gold" />}
            title={beat ? "You approved the item" : "24 hours to inspect"}
            body={
              beat
                ? "Happy with it? Approve and the seller is paid right away."
                : "Check the item against what was agreed. Approve it, or open a dispute. If you do nothing, the money is released when the window ends."
            }
            chip={beat ? "Approved" : "Inspection window"}
          />
        )}

        {stage === 6 && (
          <StatusCard
            icon={beat ? <Wallet className="h-10 w-10 text-gold" /> : <Loader2 className="h-10 w-10 animate-spin text-gold" />}
            title={beat ? "Seller paid by M-Pesa" : "Paying the seller"}
            body={
              beat
                ? `${currency(q.sellerReceives)} sent to the seller's M-Pesa. Deal complete.`
                : "ZUNO releases the money from escrow to the seller's M-Pesa."
            }
            chip={beat ? "Released" : "Releasing"}
          />
        )}

        {done && (
          <div className="rounded-3xl border border-gold/30 bg-gradient-card p-6 text-center shadow-card">
            <CheckCircle2 className="mx-auto h-8 w-8 text-gold" />
            <h2 className="mt-3 text-lg font-bold">That is how a ZUNO deal works</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The seller confirmed your terms, your money stayed in escrow until you were happy, and the seller was paid.
            </p>
          </div>
        )}

        </div>

        <Tracker stage={stage} />

        {done && (
          <div className="grid gap-3 sm:grid-cols-2 lg:col-start-1 lg:row-start-2">
            <Link
              to="/app/new-escrow"
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gold font-semibold sm:col-span-2 text-gold-foreground shadow-card active:scale-[0.98]"
            >
              Create a Real Escrow <ChevronRight className="h-4 w-4" />
            </Link>
            <button
              onClick={onRestart}
              className="flex h-12 w-full items-center justify-center rounded-2xl border border-border/40 bg-surface text-sm font-medium text-muted-foreground active:scale-[0.98]"
            >
              Watch the Demo Again
            </button>
            <Link
              to="/app"
              className="flex h-12 w-full items-center justify-center rounded-2xl border border-border/40 bg-surface text-sm font-medium text-muted-foreground active:scale-[0.98]"
            >
              Back to Home
            </Link>
          </div>
        )}
       </div>
      </div>
    </div>
  );
}

/* ---------------- pieces ---------------- */

function Banner({ text }: { text: string }) {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-2xl border border-gold/25 bg-gold/5 p-3">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
      <p className="text-[11px] leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-border/30 pt-3 first:border-t-0 first:pt-0">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{k}</span>
      <span className={`max-w-[62%] text-right text-xs ${strong ? "font-bold text-gold" : "font-medium"}`}>{v}</span>
    </div>
  );
}

function RequestCard({ q }: { q: ReturnType<typeof quote> }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 space-y-3 rounded-3xl border border-border/40 bg-surface p-5 shadow-card duration-300 lg:p-6">
      <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground">YOUR REQUEST TO THE SELLER</p>
      <Row k="Seller" v="Gadget World" />
      <Row k="Item" v="iPhone 17 Pro Max, 256GB" />
      <Row k="Agreed price" v={currency(AMOUNT)} strong />
      <Row k="You expect" v="Brand new and sealed, Natural Titanium, with box, charger and receipt." />
      <Row k="Delivery" v="Seller delivers" />
      <Breakdown q={q} />
      <p className="text-[11px] text-muted-foreground">
        The seller must agree to these terms in writing before you pay anything. This is what a dispute is judged against.
      </p>
    </div>
  );
}

function Breakdown({ q }: { q: ReturnType<typeof quote> }) {
  return (
    <dl className="mt-3 space-y-2 rounded-2xl border border-border/40 bg-background/40 p-4 text-sm">
      <div className="flex justify-between"><dt className="text-muted-foreground">Item price</dt><dd className="font-medium">{currency(AMOUNT)}</dd></div>
      <div className="flex justify-between"><dt className="text-muted-foreground">Escrow fee (your half)</dt><dd className="font-medium">{currency(q.buyerShare)}</dd></div>
      <div className="h-px bg-border/60" />
      <div className="flex justify-between"><dt className="font-semibold">You pay</dt><dd className="text-lg font-bold">{currency(q.buyerPays)}</dd></div>
      <p className="text-[11px] text-muted-foreground">{FEE_PERCENT}% fee, shared equally with the seller.</p>
    </dl>
  );
}

function StatusCard({
  icon, title, body, chip, children,
}: { icon: React.ReactNode; title: string; body: string; chip: string; children?: React.ReactNode }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 rounded-3xl border border-border/40 bg-surface p-6 text-center shadow-card duration-300 lg:p-8">
      <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-gold/10">{icon}</div>
      <h2 className="mt-5 text-lg font-bold lg:text-xl">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground lg:text-base">{body}</p>
      <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-3 py-1.5 text-[11px] font-semibold text-gold">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" />
        {chip}
      </div>
      {children && <div className="mt-4 text-left">{children}</div>}
    </div>
  );
}

function Tracker({ stage }: { stage: number }) {
  return (
    <div className="rounded-3xl border border-border/40 bg-surface p-5 lg:sticky lg:top-28 lg:col-start-2 lg:row-span-2 lg:row-start-1">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">The ZUNO process</p>
      <ul className="mt-4 space-y-3">
        {STAGES.map((s, i) => {
          const finished = i < stage;
          const current = i === stage;
          return (
            <li key={s.label} className="flex items-center gap-3">
              {finished ? (
                <CheckCircle2 className="h-5 w-5 text-gold" />
              ) : (
                <Circle className={`h-5 w-5 ${current ? "text-gold" : "text-muted-foreground/40"}`} />
              )}
              <span className={`text-sm ${finished || current ? "font-semibold" : "text-muted-foreground"}`}>{s.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
