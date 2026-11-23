import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Reveal } from "@/components/site/Reveal";
import { ArrowRight, CheckCircle2, ShieldCheck, Zap, Sparkles } from "lucide-react";
import { calculateFlatFee, formatKES, FLAT_FEE_PCT, BUYER_SHARE_PCT, SELLER_SHARE_PCT } from "@/lib/fees";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — ZUNO Escrow" },
      {
        name: "description",
        content:
          "Simple, flat 2.5% escrow fee, split evenly 50/50 between buyer (1.25%) and seller (1.25%). Calculate your exact deposit and payout in KES before you commit.",
      },
      { property: "og:title", content: "Pricing — ZUNO Escrow" },
      { property: "og:description", content: "Flat 2.5% fee split 50/50. No subscriptions. No hidden costs." },
    ],
  }),
  component: PricingPage,
});

const DEFAULT_AMOUNT = 5000;
const PRESETS = [1000, 2500, 5000, 10000, 25000, 50000];

function PricingPage() {
  const [amount, setAmount] = useState(String(DEFAULT_AMOUNT));

  const calc = useMemo(() => {
    const n = Math.max(0, Number(amount.replace(/[^0-9.]/g, "")) || 0);
    return calculateFlatFee(n);
  }, [amount]);

  return (
    <>
      {/* Hero */}
      <section className="pt-32 pb-14 lg:pt-40">
        <div className="mx-auto max-w-[1200px] px-6 lg:px-8">
          <p className="eyebrow">Transparent Pricing</p>
          <h1 className="text-display-lg mt-4 max-w-[22ch]">
            One simple fee. <span className="text-[color:var(--gold-text)]">2.5%</span> per deal, split 50/50.
          </h1>
          <p className="mt-5 max-w-2xl text-body-lg text-muted-foreground">
            ZUNO charges a transparent flat fee of <strong>2.5%</strong> of the transaction value — split evenly between
            buyer (<strong>1.25%</strong>) and seller (<strong>1.25%</strong>). No hidden charges, no monthly subscriptions, and zero fee if a deal is refunded.
          </p>
        </div>
      </section>

      {/* Interactive calculator */}
      <section className="py-12 lg:py-20">
        <div className="mx-auto grid max-w-[1200px] items-start gap-12 px-6 lg:grid-cols-[1.25fr_1fr] lg:gap-16 lg:px-8">
          <Reveal>
            <div className="rounded-[24px] border border-border gradient-card p-8 shadow-elevated">
              <div className="flex items-center justify-between">
                <p className="eyebrow">Fee Calculator</p>
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                  <Sparkles className="h-3.5 w-3.5" /> 2.5% Flat Rate
                </span>
              </div>

              {/* Amount input */}
              <label htmlFor="amt" className="eyebrow mt-6 block text-xs">
                Enter item price (KES)
              </label>
              <div className="mt-2.5 flex items-center gap-3 rounded-[16px] border border-border bg-surface px-4 py-3.5 focus-within:border-primary/60 transition-colors">
                <span className="font-mono text-sm font-semibold text-muted-foreground">KES</span>
                <input
                  id="amt"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className="w-full bg-transparent font-mono text-3xl font-semibold text-foreground focus:outline-none"
                />
              </div>

              {/* Quick presets */}
              <div className="mt-3 flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setAmount(String(p))}
                    className="rounded-xl border border-border/70 bg-surface px-3 py-1.5 text-xs font-mono text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
                  >
                    KES {p.toLocaleString()}
                  </button>
                ))}
              </div>

              {/* Breakdown */}
              <dl className="mt-8 space-y-4">
                <Row label="Agreed item price" value={calc.itemPrice} strong />
                <Row
                  label="Total ZUNO escrow fee (2.5%)"
                  value={calc.totalFeeAmount}
                  muted
                />
                <div className="my-3 border-t border-border/60" />
                <div className="rounded-2xl border border-border/70 bg-surface/70 p-4 space-y-3">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-muted-foreground">Buyer pays (+1.25% fee)</span>
                    <span className="font-mono font-semibold text-foreground">
                      {formatKES(calc.buyerDeposit)}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-muted-foreground">Seller receives (-1.25% fee)</span>
                    <span className="font-mono font-semibold text-foreground">
                      {formatKES(calc.sellerPayout)}
                    </span>
                  </div>
                </div>
              </dl>

              <p className="mt-6 text-xs text-muted-foreground leading-relaxed">
                The fee is shared equally. The buyer deposits their half when funding escrow via M-Pesa. The seller's half is deducted only when the buyer approves the goods and funds are released.
              </p>
            </div>
          </Reveal>

          {/* Value props */}
          <Reveal delay={80}>
            <div className="space-y-4">
              <Point
                icon={ShieldCheck}
                k="Split 50/50, Always"
                v="Neither party bears the full cost. The buyer and seller split the 2.5% protection fee equally (1.25% each)."
              />
              <Point
                icon={Zap}
                k="100% Free If Cancelled or Refunded"
                v="If the deal falls through before completion or a dispute results in a return, ZUNO does not keep any platform fee."
              />
              <Point
                icon={CheckCircle2}
                k="Zero Subscriptions or Hidden Costs"
                v="No setup fees, no monthly software costs, and no withdrawal fees. You only pay when you transact."
              />

              <div className="rounded-[18px] border border-gold/30 bg-gold/5 p-5">
                <p className="text-xs font-bold tracking-wider text-gold">MERCHANTS & ENTERPRISE</p>
                <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                  Processing high transaction volume or running an e-commerce shop? Contact us for volume tiering and automated webhook integrations.
                </p>
              </div>

              <div className="pt-2">
                <Link
                  to="/auth/signup"
                  className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-gold px-6 text-sm font-semibold text-gold-foreground shadow-gold hover:opacity-90 transition-opacity"
                >
                  Start a Protected Deal <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Real examples table */}
      <section className="py-16 border-t border-border/60">
        <div className="mx-auto max-w-[1200px] px-6 lg:px-8">
          <Reveal className="max-w-[52ch]">
            <p className="eyebrow">Real Examples</p>
            <h2 className="text-heading-lg mt-3">
              What real deals look like with ZUNO's 2.5% fee.
            </h2>
          </Reveal>

          <div className="mt-8 grid gap-6 md:grid-cols-3">
            <ExampleCard
              title="Starter Deal"
              price={1000}
              desc="Electronics accessories, shoes, clothing"
            />
            <ExampleCard
              title="Mid-Range Deal"
              price={10000}
              desc="Smartphones, tablets, designer watches"
              highlight
            />
            <ExampleCard
              title="High-Value Deal"
              price={50000}
              desc="Laptops, cameras, premium merchandise"
            />
          </div>
        </div>
      </section>
    </>
  );
}

function ExampleCard({ title, price, desc, highlight }: { title: string; price: number; desc: string; highlight?: boolean }) {
  const calc = calculateFlatFee(price);

  return (
    <Reveal>
      <div
        className={
          "h-full rounded-[20px] border p-6 shadow-card flex flex-col justify-between transition-all " +
          (highlight
            ? "border-primary/50 bg-gradient-card shadow-elevated"
            : "border-border bg-surface")
        }
      >
        <div>
          <div className="flex items-center justify-between">
            <p className="eyebrow">{title}</p>
            <span className="font-mono text-xs font-semibold text-primary">2.5% Total</span>
          </div>
          <p className="mt-2 font-mono text-3xl font-bold text-foreground">
            {formatKES(price)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
        </div>

        <dl className="mt-6 space-y-2.5 border-t border-border/60 pt-4">
          <div className="flex items-baseline justify-between text-xs">
            <dt className="text-muted-foreground">Total Escrow Fee</dt>
            <dd className="font-mono font-medium text-foreground">{formatKES(calc.totalFeeAmount)}</dd>
          </div>
          <div className="flex items-baseline justify-between text-sm">
            <dt className="text-muted-foreground">Buyer Deposits</dt>
            <dd className="font-mono font-semibold text-primary">{formatKES(calc.buyerDeposit)}</dd>
          </div>
          <div className="flex items-baseline justify-between text-sm">
            <dt className="text-muted-foreground">Seller Receives</dt>
            <dd className="font-mono font-semibold text-foreground">{formatKES(calc.sellerPayout)}</dd>
          </div>
        </dl>
      </div>
    </Reveal>
  );
}

function Row({ label, value, strong, muted }: { label: string; value: number; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={"text-sm " + (muted ? "text-muted-foreground" : "text-foreground")}>{label}</dt>
      <dd
        className={
          "font-mono " +
          (strong ? "text-xl font-semibold text-foreground" : muted ? "text-sm text-muted-foreground" : "text-base font-medium text-foreground")
        }
      >
        {formatKES(value)}
      </dd>
    </div>
  );
}

function Point({ icon: Icon, k, v }: { icon: typeof ShieldCheck; k: string; v: string }) {
  return (
    <div className="rounded-[18px] border border-border bg-surface p-5 flex items-start gap-4">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="font-semibold text-sm text-foreground">{k}</p>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{v}</p>
      </div>
    </div>
  );
}
