import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, ShieldCheck, Check, ChevronRight, FileText, Send,
  Smartphone, CreditCard, Building2, Wallet, Clock, CheckCircle2, Circle,
  Copy, Sparkles,
} from "lucide-react";
import { currency } from "@/lib/zuno-data";
import { KycGate } from "@/components/zuno/KycGate";
import { NewDealRequest } from "@/components/zuno/NewDealRequest";
import { ThemeToggle } from "@/components/zuno/ThemeToggle";
import { assertKycVerified } from "@/lib/zuno-kyc";
import { transactionsService } from "@/services/transactions.service";
import { transactionKeys } from "@/hooks/queries/useTransactions";

export const Route = createFileRoute("/app/new-escrow")({
  head: () => ({ meta: [{ title: "New Escrow — ZUNO" }] }),
  validateSearch: (s: Record<string, unknown>): { seller?: string } => ({
    seller: typeof s.seller === "string" ? s.seller : undefined,
  }),
  component: RealNewDeal,
});

// The real flow. The scripted wizard below (`NewEscrow`) is only used by the /app/demo walkthrough.
function RealNewDeal() {
  const { seller } = Route.useSearch();
  return (
    <KycGate fallback="/app">
      <NewDealRequest presetSellerId={seller} />
    </KycGate>
  );
}

type Step = 1 | 2 | 3 | 4 | 5;

type FormState = {
  product: string;
  description: string;
  sellerName: string;
  sellerContact: string;
  amount: string;
  timeline: string;
  category: string;
  notes: string;
  agreed: boolean;
  payment: "mpesa" | "";
};

const initial: FormState = {
  product: "", description: "", sellerName: "", sellerContact: "",
  amount: "", timeline: "7 days", category: "Electronics", notes: "",
  agreed: false, payment: "",
};

// Matches the scripted WhatsApp chat + amount used by the passive demo on
// /app/demo (see app.demo.tsx) so the wizard picks up where the chat left off.
const DEMO_AMOUNT = 191311;
const demoInitial: FormState = {
  product: "iPhone 17 Pro Max",
  description: "Brand new, sealed, 256GB, Natural Titanium.",
  sellerName: "Gadget World",
  sellerContact: "+254 711 222 333",
  amount: String(DEMO_AMOUNT),
  timeline: "7 days",
  category: "Electronics",
  notes: "",
  agreed: false,
  payment: "",
};

export function NewEscrow({
  demo = false, auto = false, onRestart,
}: { demo?: boolean; auto?: boolean; onRestart?: () => void } = {}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormState>(demo ? demoInitial : initial);
  const [persistedId, setPersistedId] = useState<string | null>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const amountNum = Number(form.amount.replace(/[^\d]/g, "")) || 0;
  const fee = Math.round(amountNum * 0.015);
  const total = amountNum + fee;
  const dealId = useMemo(() => "ZUNO" + Math.random().toString(36).slice(2, 12).toUpperCase(), []);

  // Once escrow is funded (step 5), persist it as a real transaction so it
  // shows up in Activity/Home instead of disappearing once the wizard closes.
  useEffect(() => {
    if (step !== 5 || persistedId) return;
    // Demo runs are watch-only — the chat already says nothing will be
    // charged and no delivery will be created, so never write a real
    // transaction to Activity/Home.
    if (demo) return;
    // Defense-in-depth: KycGate already blocks unverified users from reaching
    // this screen, but this mutating handler re-asserts it directly (see
    // assertKycVerified's docstring) so a UI bypass still fails loudly
    // instead of silently persisting a transaction.
    try {
      assertKycVerified();
    } catch {
      return;
    }
    transactionsService
      .create({
        item: form.product || "New item",
        seller: form.sellerName || "Unknown seller",
        sellerId: form.sellerName.toLowerCase().replace(/\s+/g, "-") || "unknown-seller",
        amount: amountNum,
        category: form.category,
      })
      .then((created) => {
        setPersistedId(created.id);
        queryClient.invalidateQueries({ queryKey: transactionKeys.all });
        queryClient.invalidateQueries({ queryKey: transactionKeys.active });
      })
      .catch(() => {
        // Non-fatal — the confirmation screen still shows the deal summary
        // even if persistence fails; the user can retry from Activity.
      });
  }, [step, persistedId, form, amountNum, queryClient, demo]);

  // Auto mode drives the wizard forward on its own timeline — no typing,
  // no taps. Paced slowly enough to actually read each screen. Step 3
  // advances itself once the seller "accepts" (passed down via the `auto`
  // prop below); step 5 is the final screen, where we stop and hand control
  // back to the viewer instead of auto-advancing any further.
  useEffect(() => {
    if (!auto) return;
    if (step === 1) {
      const t = setTimeout(() => setStep(2), 3200);
      return () => clearTimeout(t);
    }
    if (step === 2) {
      const t1 = setTimeout(() => set("agreed", true), 1800);
      const t2 = setTimeout(() => setStep(3), 3400);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
    if (step === 4) {
      const t1 = setTimeout(() => set("payment", "mpesa"), 1600);
      const t2 = setTimeout(() => setStep(5), 3800);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [auto, step]);

  const back = () => {
    if (step === 1) navigate({ to: "/app" });
    else setStep((s) => (s - 1) as Step);
  };

  return (
    <div className="flex-1 overflow-y-auto pb-8">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border/40 bg-background/85 px-4 sm:px-6 pt-6 pb-4 backdrop-blur">
        <button onClick={back} aria-label="Back" className="grid h-10 w-10 place-items-center rounded-xl bg-surface transition-colors hover:bg-surface-2">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Step {step} of 5
          </p>
          <h1 className="text-base font-bold">
            {step === 1 && "Create New Escrow"}
            {step === 2 && "Deal Contract"}
            {step === 3 && "Awaiting Seller"}
            {step === 4 && "Fund Escrow"}
            {step === 5 && "Escrow Confirmed"}
          </h1>
        </div>
        <ThemeToggle />
      </header>

      {/* Progress */}
      <div className="px-4 sm:px-6 pt-4">
        <div className="flex h-1.5 overflow-hidden rounded-full bg-surface">
          <div
            className="h-full rounded-full bg-gradient-to-r from-gold to-gold/70 transition-all"
            style={{ width: `${(step / 5) * 100}%` }}
          />
        </div>
      </div>

      {step === 1 && (
        <Step1 form={form} set={set} onNext={() => setStep(2)} />
      )}
      {step === 2 && (
        <Step2
          form={form}
          fee={fee}
          total={total}
          amountNum={amountNum}
          onAgree={(v) => set("agreed", v)}
          onNext={() => setStep(3)}
        />
      )}
      {step === 3 && <Step3 onNext={() => setStep(4)} auto={auto} />}
      {step === 4 && (
        <Step4
          form={form}
          fee={fee}
          total={total}
          amountNum={amountNum}
          onPick={(p) => set("payment", p)}
          onNext={() => setStep(5)}
        />
      )}
      {step === 5 && (
        <Step5
          form={form}
          amountNum={amountNum}
          dealId={persistedId ?? dealId}
          demo={demo}
          onRestart={onRestart}
        />
      )}
    </div>
  );
}

/* ---------------- Step 1: Details ---------------- */
function Step1({
  form, set, onNext,
}: { form: FormState; set: <K extends keyof FormState>(k: K, v: FormState[K]) => void; onNext: () => void }) {
  const valid = form.product && form.sellerName && form.sellerContact && form.amount;
  return (
    <div className="px-4 sm:px-6 pt-5">
      <TrustBanner text="Your details build a binding contract held safely in escrow." />
      <div className="mt-5 space-y-4">
        <Field label="Product / Service Name" value={form.product} onChange={(v) => set("product", v)} placeholder="e.g. iPhone 17 Pro Max" />
        <Field label="Product Description" value={form.description} onChange={(v) => set("description", v)} placeholder="Condition, specs, colour…" textarea />
        <Field label="Seller Name" value={form.sellerName} onChange={(v) => set("sellerName", v)} placeholder="Full name or business" />
        <Field label="Seller Phone / Email" value={form.sellerContact} onChange={(v) => set("sellerContact", v)} placeholder="+254 7… or name@email.com" />
        <Field label="Escrow Amount (KES)" value={form.amount} onChange={(v) => set("amount", v.replace(/[^\d]/g, ""))} placeholder="0" inputMode="numeric" />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Delivery Timeline" value={form.timeline} onChange={(v) => set("timeline", v)}
            options={["3 days", "7 days", "14 days", "30 days"]} />
          <Select label="Category" value={form.category} onChange={(v) => set("category", v)}
            options={["Electronics", "Fashion", "Furniture", "Vehicles", "Services", "Other"]} />
        </div>
        <Field label="Additional Notes" value={form.notes} onChange={(v) => set("notes", v)} placeholder="Optional" textarea />
      </div>

      <PrimaryButton disabled={!valid} onClick={onNext}>Continue</PrimaryButton>
    </div>
  );
}

/* ---------------- Step 2: Contract ---------------- */
function Step2({
  form, fee, total, amountNum, onAgree, onNext,
}: {
  form: FormState; fee: number; total: number; amountNum: number;
  onAgree: (v: boolean) => void; onNext: () => void;
}) {
  return (
    <div className="px-4 sm:px-6 pt-5">
      <div className="rounded-3xl border border-border/40 bg-surface p-5 shadow-card">
        <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.16em] text-muted-foreground">
          <FileText className="h-4 w-4 text-gold" /> DEAL CONTRACT
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Generated automatically</p>

        <ContractRow label="Buyer" value="Alvan · +254 7•• ••• •••" />
        <ContractRow label="Seller" value={`${form.sellerName} · ${form.sellerContact}`} />
        <ContractRow label="Product" value={form.product} />
        {form.description && <ContractRow label="Description" value={form.description} />}
        <ContractRow label="Escrow Amount" value={currency(amountNum)} strong />
        <ContractRow label="Platform Fee (1.5%)" value={currency(fee)} />
        <ContractRow label="Delivery Deadline" value={`Within ${form.timeline}`} />
        <ContractRow label="Refund" value="100% refund if undelivered or rejected." />
        <ContractRow label="Disputes" value="Reviewed by ZUNO within 48 hours." />
        <ContractRow label="Protection" value="Funds locked in escrow until release." />
      </div>

      <TrustBanner text="Funds will remain securely held by ZUNO until delivery is confirmed or a dispute is resolved." />

      <label className="mt-4 flex items-start gap-3 rounded-2xl border border-border/40 bg-surface p-4">
        <input
          type="checkbox"
          checked={form.agreed}
          onChange={(e) => onAgree(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-gold"
        />
        <span className="text-xs text-muted-foreground">
          I agree to the contract terms and authorise ZUNO to act as escrow agent.
        </span>
      </label>

      <PrimaryButton disabled={!form.agreed} onClick={onNext}>
        <Send className="mr-2 h-4 w-4" /> Send Contract to Seller
      </PrimaryButton>
    </div>
  );
}

/* ---------------- Step 3: Awaiting Seller ---------------- */
function Step3({ onNext, auto }: { onNext: () => void; auto?: boolean }) {
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setAccepted(true), 3600);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!auto || !accepted) return;
    const t = setTimeout(onNext, 2000);
    return () => clearTimeout(t);
  }, [auto, accepted, onNext]);
  return (
    <div className="px-4 sm:px-6 pt-8">
      <div className="rounded-3xl border border-border/40 bg-surface p-6 text-center shadow-card">
        <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-gold/10">
          {accepted ? <Check className="h-10 w-10 text-gold" /> : <Clock className="h-10 w-10 text-gold animate-pulse" />}
        </div>
        <h2 className="mt-5 text-lg font-bold">
          {accepted ? "Seller Accepted ✓" : "Awaiting Seller Acceptance"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {accepted
            ? "The seller has reviewed and accepted the contract."
            : "The seller has been notified. They can accept, request changes, or reject."}
        </p>
        <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-3 py-1.5 text-[11px] font-semibold text-gold">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" />
          {accepted ? "Ready for Funding" : "Awaiting Response"}
        </div>
      </div>
      <PrimaryButton disabled={!accepted} onClick={onNext}>
        Continue to Funding <ChevronRight className="ml-1 h-4 w-4" />
      </PrimaryButton>
    </div>
  );
}

/* ---------------- Step 4: Fund Escrow ---------------- */
function Step4({
  form, fee, total, amountNum, onPick, onNext,
}: {
  form: FormState; fee: number; total: number; amountNum: number;
  onPick: (p: FormState["payment"]) => void; onNext: () => void;
}) {
  const methods: { id: FormState["payment"]; label: string; sub: string; Icon: typeof Smartphone }[] = [
    { id: "mpesa", label: "M-Pesa", sub: "Instant · STK Push", Icon: Smartphone },
  ];
  return (
    <div className="px-4 sm:px-6 pt-5">
      <div className="rounded-3xl border border-border/40 bg-gradient-card p-5 shadow-card">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Escrow Amount</span>
          <span className="font-semibold">{currency(amountNum)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Platform Fee</span>
          <span className="font-semibold">{currency(fee)}</span>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total</span>
          <span className="text-2xl font-bold text-gold">{currency(total)}</span>
        </div>
      </div>

      <p className="mt-6 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Payment Method
      </p>
      <div className="mt-3 space-y-2">
        {methods.map(({ id, label, sub, Icon }) => {
          const active = form.payment === id;
          return (
            <button
              key={id}
              onClick={() => onPick(id)}
              className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition-colors ${
                active ? "border-gold bg-gold/10" : "border-border/40 bg-surface"
              }`}
            >
              <span className={`grid h-10 w-10 place-items-center rounded-xl ${active ? "bg-gold text-gold-foreground" : "bg-surface-2 text-gold"}`}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="flex-1">
                <span className="block text-sm font-semibold">{label}</span>
                <span className="block text-[11px] text-muted-foreground">{sub}</span>
              </span>
              <span className={`h-4 w-4 rounded-full border-2 ${active ? "border-gold bg-gold" : "border-border"}`} />
            </button>
          );
        })}
      </div>

      <TrustBanner text="Funds are locked in escrow the moment you pay. Seller never sees them until delivery is confirmed." />

      <PrimaryButton disabled={!form.payment} onClick={onNext}>
        Pay {currency(total)}
      </PrimaryButton>
    </div>
  );
}

/* ---------------- Step 5: QR Payment ---------------- */
/* ---------------- Step 5: Confirmation ---------------- */
function Step5({
  form, amountNum, dealId, demo, onRestart,
}: { form: FormState; amountNum: number; dealId: string; demo?: boolean; onRestart?: () => void }) {
  const navigate = useNavigate();
  const tracker = [
    { label: "Create Deal", done: true },
    { label: "Contract Accepted", done: true },
    { label: "Fund Escrow", done: true },
    { label: "Seller Delivering", done: false },
    { label: "Delivered", done: false },
    { label: "Released", done: false },
  ];
  const eta = new Date();
  eta.setDate(eta.getDate() + Number(form.timeline.split(" ")[0]));
  const etaStr = eta.toLocaleDateString("en-GB");

  return (
    <div className="px-4 sm:px-6 pt-5">
      <div className="rounded-3xl border border-gold/30 bg-gradient-card p-6 text-center shadow-card">
        <Sparkles className="mx-auto h-7 w-7 text-gold" />
        <h2 className="mt-3 text-lg font-bold">Funds Secured</h2>
        <p className="mt-1 text-3xl font-bold tracking-tight">{currency(amountNum)}</p>
        <p className="mt-2 text-[11px] text-muted-foreground">held safely in ZUNO escrow</p>
      </div>

      <div className="mt-4 space-y-1 rounded-3xl border border-border/40 bg-surface p-5">
        <ConfRow label="Escrow ID" value={dealId} copy />
        <ConfRow label="Amount Held" value={currency(amountNum)} />
        <ConfRow label="Seller" value={form.sellerName} />
        <ConfRow label="Date Created" value={new Date().toLocaleDateString("en-GB")} />
        <ConfRow label="Expected Delivery" value={etaStr} />
      </div>

      <div className="mt-4 rounded-3xl border border-border/40 bg-surface p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Progress</p>
        <ul className="mt-4 space-y-3">
          {tracker.map((t, i) => (
            <li key={i} className="flex items-center gap-3">
              {t.done ? (
                <CheckCircle2 className="h-5 w-5 text-gold" />
              ) : (
                <Circle className="h-5 w-5 text-muted-foreground/40" />
              )}
              <span className={`text-sm ${t.done ? "font-semibold" : "text-muted-foreground"}`}>
                {t.label}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {demo ? (
        <div className="mt-6 space-y-3">
          <div className="rounded-2xl border border-border/40 bg-surface px-4 py-3 text-center text-xs text-muted-foreground">
            This was a demo — no real deal was created. What would you like to do next?
          </div>
          <button
            onClick={() => navigate({ to: "/app/new-escrow" })}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gold font-semibold text-gold-foreground shadow-card active:scale-[0.98]"
          >
            Create a Real Escrow <ChevronRight className="h-4 w-4" />
          </button>
          {onRestart && (
            <button
              onClick={onRestart}
              className="flex h-12 w-full items-center justify-center rounded-2xl border border-border/40 bg-surface text-sm font-medium text-muted-foreground active:scale-[0.98]"
            >
              Watch the Demo Again
            </button>
          )}
          <button
            onClick={() => navigate({ to: "/app" })}
            className="flex h-12 w-full items-center justify-center rounded-2xl border border-border/40 bg-surface text-sm font-medium text-muted-foreground active:scale-[0.98]"
          >
            Back to Home
          </button>
        </div>
      ) : (
        <>
          <Link
            to="/app/tracking/$id"
            params={{ id: dealId }}
            className="mt-6 flex h-12 items-center justify-center gap-2 rounded-2xl bg-gold font-semibold text-gold-foreground shadow-card active:scale-[0.98]"
          >
            Track Deal <ChevronRight className="h-4 w-4" />
          </Link>
          <Link
            to="/app"
            className="mt-3 flex h-12 items-center justify-center rounded-2xl border border-border/40 bg-surface text-sm font-medium text-muted-foreground"
          >
            Back to Home
          </Link>
        </>
      )}
    </div>
  );
}

/* ---------------- Shared bits ---------------- */
function Field({
  label, value, onChange, placeholder, textarea, inputMode,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; textarea?: boolean; inputMode?: "numeric" | "text";
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="w-full resize-none rounded-2xl border border-border/40 bg-surface px-4 py-3 text-sm outline-none focus:border-gold/60"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          inputMode={inputMode}
          className="w-full rounded-2xl border border-border/40 bg-surface px-4 py-3 text-sm outline-none focus:border-gold/60"
        />
      )}
    </label>
  );
}

function Select({
  label, value, onChange, options,
}: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-2xl border border-border/40 bg-surface px-4 py-3 text-sm outline-none focus:border-gold/60"
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function PrimaryButton({
  children, disabled, onClick,
}: { children: React.ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="mt-6 flex h-12 w-full items-center justify-center rounded-2xl bg-gold font-semibold text-gold-foreground shadow-card transition-opacity active:scale-[0.98] disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function TrustBanner({ text }: { text: string }) {
  return (
    <div className="mt-4 flex items-start gap-2 rounded-2xl border border-gold/25 bg-gold/5 p-3">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
      <p className="text-[11px] leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}

function ContractRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="mt-3 flex items-start justify-between gap-4 border-t border-border/30 pt-3 first:border-t-0 first:pt-3">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`max-w-[60%] text-right text-xs ${strong ? "font-bold text-gold" : "font-medium"}`}>{value}</span>
    </div>
  );
}

function ConfRow({ label, value, copy }: { label: string; value: string; copy?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2 text-sm font-semibold">
        {value}
        {copy && (
          <button
            onClick={async () => {
              try {
                await navigator.clipboard?.writeText(value);
                toast.success("Copied to clipboard");
              } catch {
                toast.error("Couldn't copy — select and copy manually.");
              }
            }}
            aria-label={`Copy ${label}`}
            className="text-muted-foreground transition-colors hover:text-gold"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
    </div>
  );
}
