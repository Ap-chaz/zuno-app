import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { NotificationBell } from "@/components/zuno/NotificationBell";
import { useDisputes } from "@/hooks/queries/useDisputes";
import {
  Bell,
  AlertTriangle,
  TrendingUp,
  Package,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  BadgeCheck,
  Clock,
  ShieldAlert,
  Sparkles,
  LineChart,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Logo } from "@/components/zuno/Logo";
import { ThemeToggle } from "@/components/zuno/ThemeToggle";
import { SellerKycBanner, SellerKycWelcome } from "@/components/zuno/SellerKyc";
import { useAuth } from "@/hooks/useAuth";
import { parseAnyDate } from "@/lib/api/mappers";
import { getAvatarInitial, getFirstName } from "@/lib/user-display";
import { currency } from "@/lib/zuno-data";
import { useSellerTier } from "@/lib/seller-business-verification";
import { useTransactions } from "@/hooks/queries/useTransactions";
import { ErrorState } from "@/components/common/StateViews";
import type { SellerVerificationTier, Transaction } from "@/types/models";

export const Route = createFileRoute("/seller/")({
  head: () => ({ meta: [{ title: "Seller Dashboard — ZUNO" }] }),
  component: SellerHome,
});

function timeOfDayGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// Seed dates are "DD/MM/YYYY" — convert to something Date() parses correctly.
const parseDate = parseAnyDate;

/**
 * Aggregate real transaction data into the numbers this dashboard needs.
 * NOTE: same convention as the rest of the app — there's no real per-seller
 * account table yet (see auth.service.ts), so — matching the Buyer
 * dashboard and Admin screens — every mock transaction is treated as
 * belonging to the current session rather than inventing a seller-id
 * filter with nothing real to filter against.
 */
function useSellerStats() {
  const { data: transactions, isLoading, isError, refetch } = useTransactions();

  const stats = useMemo(() => {
    const list = transactions ?? [];
    const completed = list.filter((t) => t.status === "Completed" || t.status === "Resolved");
    const inEscrow = list.filter((t) => ["Funded", "Protected", "In transit", "Inspection"].includes(t.status));
    const disputed = list.filter((t) => t.status === "Disputed");

    const earned = completed.reduce((sum, t) => sum + (t.sellerReceives ?? t.amount), 0);
    const pendingPayout = completed.filter((t) => t.payoutStatus !== "paid").reduce((sum, t) => sum + (t.sellerReceives ?? t.amount), 0);
    const inEscrowTotal = inEscrow.reduce((sum, t) => sum + (t.sellerReceives ?? t.amount), 0);

    const recent = [...list].sort((a, b) => parseDate(b.date).getTime() - parseDate(a.date).getTime()).slice(0, 3);

    // Sales by weekday across all known transactions (not "last 7 days" —
    // the seed dates don't track the real calendar, so a genuine rolling
    // 7-day window would just show zeros; this is the closest real
    // breakdown the mock data actually supports).
    const byWeekday = [0, 0, 0, 0, 0, 0, 0]; // Mon..Sun
    for (const t of list) {
      const day = (parseDate(t.date).getDay() + 6) % 7; // convert Sun=0 -> Mon=0
      byWeekday[day] += t.sellerReceives ?? t.amount;
    }
    const maxDay = Math.max(1, ...byWeekday);

    return {
      earned,
      pendingPayout,
      inEscrowTotal,
      activeCount: inEscrow.length,
      completedCount: completed.length,
      disputedCount: disputed.length,
      recent,
      byWeekday,
      maxDay,
    };
  }, [transactions]);

  return { ...stats, isLoading, isError, refetch };
}

/**
 * Every seller lands here first. Only sellers an admin has marked
 * "verified" (business verification approved — see /seller/verification
 * and the admin Seller Verification Queue) get the full analytics-heavy
 * Business dashboard. Everyone else — the common case: someone who just
 * wants to sell a phone or two through escrow, not run a shop — gets the
 * simpler Basic dashboard, with a clear path to upgrade.
 */
function SellerHome() {
  const tier = useSellerTier();
  return tier === "verified" ? <BusinessDashboard /> : <BasicSellerDashboard tier={tier} />;
}

function SellerHeader({ subtitle }: { subtitle: string }) {
  const { user } = useAuth();
  const firstName = getFirstName(user);
  const isBusiness = useSellerTier() === "verified";
  return (
    <>
      <header className="flex items-center justify-between px-4 pt-6 sm:px-6 lg:px-0 lg:pt-0">
        <div className="flex items-center gap-2 lg:hidden">
          <Logo />
          <span className="rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] font-bold text-gold">SELLER</span>
        </div>
        <div className="hidden lg:block">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{timeOfDayGreeting()}, {firstName} 👋</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <NotificationBell to="/seller/notifications" />
          <Link to="/seller/account" className="grid h-10 w-10 place-items-center rounded-full bg-gradient-gold text-sm font-bold text-gold-foreground">
            {getAvatarInitial(user)}
          </Link>
        </div>
      </header>
      <p className="mt-5 px-4 text-sm text-muted-foreground sm:px-6 lg:hidden">
        {timeOfDayGreeting()}, {firstName} 👋
      </p>
      <OpenDisputesBanner />
      <SellerKycBanner />
      <SellerKycWelcome />
    </>
  );
}

function RecentActivityRow({ t }: { t: Transaction }) {
  const up = t.status !== "Refunded";
  return (
    <li className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-border/40 bg-surface p-3.5 transition-colors hover:bg-surface-2">
      <span className={`grid h-10 w-10 place-items-center rounded-2xl ${up ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
        {up ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{t.item}</p>
        <p className="truncate text-xs text-muted-foreground">{t.buyerName ?? "Unknown buyer"}</p>
      </div>
      <div className="min-w-0 max-w-[9rem] text-right">
        <p className={`text-sm font-bold ${up ? "" : "text-destructive"}`}>{currency(t.amount)}</p>
        <p className="text-[10px] text-muted-foreground">{t.status}</p>
      </div>
    </li>
  );
}

/** Casual/occasional seller: simple totals + a clear upgrade path. No shop, no analytics — just their own deals. */
function BasicSellerDashboard({ tier }: { tier: SellerVerificationTier }) {
  const { earned, activeCount, completedCount, disputedCount, recent, isLoading, isError, refetch } = useSellerStats();

  return (
    <div className="flex-1 overflow-y-auto pb-6">
      <SellerHeader subtitle="Here's a quick look at your ZUNO sales." />

      <div className="mx-5 mt-5 lg:mx-0 lg:mt-6">
        <VerificationStatusCard tier={tier} />
      </div>

      {isError ? (
        <div className="mt-6 px-4 sm:px-6 lg:px-0">
          <ErrorState description="Couldn't load your sales data." onRetry={() => refetch()} />
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 px-4 sm:px-6 md:grid-cols-4 lg:mt-6 lg:gap-4 lg:px-0">
            <Stat icon={Wallet} label="Total earned" value={isLoading ? "…" : currency(earned)} delta="all time" />
            <Stat icon={Package} label="Active orders" value={isLoading ? "…" : String(activeCount)} delta="in escrow" />
            <Stat icon={TrendingUp} label="Completed" value={isLoading ? "…" : String(completedCount)} delta="all time" />
            <Stat icon={ShieldAlert} label="Disputed" value={isLoading ? "…" : String(disputedCount)} delta="all time" />
          </div>

          <section className="mt-7 px-4 sm:px-6 lg:mt-8 lg:px-0">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold lg:text-lg">Recent activity</h2>
              <Link to="/seller/transactions" className="flex items-center gap-1 text-xs font-medium text-gold lg:text-sm">
                See all <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
            {!isLoading && recent.length === 0 ? (
              <p className="mt-3 rounded-2xl border border-dashed border-border/60 bg-surface/40 px-4 py-6 text-center text-sm text-muted-foreground">
                No sales yet.
              </p>
            ) : (
              <ul className="mt-3 space-y-2 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
                {recent.slice(0, 2).map((t) => <RecentActivityRow key={t.id} t={t} />)}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function VerificationStatusCard({ tier }: { tier: SellerVerificationTier }) {
  if (tier === "pending") {
    return (
      <div className="rounded-3xl border border-gold/30 bg-gold/5 p-5 shadow-card lg:p-6">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gold/15 text-gold">
            <Clock className="h-6 w-6" />
          </span>
          <div>
            <p className="font-bold">Business verification in review</p>
            <p className="mt-0.5 text-sm text-muted-foreground">Usually takes under 24 hours. We'll notify you.</p>
          </div>
        </div>
      </div>
    );
  }

  if (tier === "flagged") {
    return (
      <div className="rounded-3xl border border-destructive/30 bg-destructive/5 p-5 shadow-card lg:p-6">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-destructive/15 text-destructive">
            <ShieldAlert className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold">Verification needs another look</p>
            <p className="mt-0.5 text-sm text-muted-foreground">Some details couldn't be confirmed. Resubmit when you're ready.</p>
          </div>
        </div>
        <Link
          to="/seller/verification"
          className="mt-4 flex h-11 w-full items-center justify-center rounded-2xl bg-gradient-gold text-sm font-semibold text-gold-foreground shadow-gold transition-opacity hover:opacity-95 lg:w-auto lg:px-8"
        >
          Resubmit details
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-border/40 bg-gradient-card p-5 shadow-card lg:p-6">
      <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.18em] text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 text-gold" /> BASIC PLAN
      </div>
      <h2 className="mt-2 text-xl font-bold lg:text-2xl">Unlock your Business Dashboard</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Get verified as a business seller to unlock sales analytics, a public seller profile buyers can browse, and a verified badge.
      </p>

      <ul className="mt-4 space-y-2">
        <BenefitRow icon={LineChart} label="Full sales analytics & earnings chart" />
        <BenefitRow icon={BadgeCheck} label="Verified badge + listing in buyer search" />
        <BenefitRow icon={Zap} label="Priority payout processing" />
      </ul>

      <Link
        to="/seller/verification"
        className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-gold text-sm font-semibold text-gold-foreground shadow-gold transition-opacity hover:opacity-95 lg:w-auto lg:px-8"
      >
        Start business verification <ArrowUpRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

function BenefitRow({ icon: Icon, label }: { icon: typeof LineChart; label: string }) {
  return (
    <li className="flex items-center gap-2.5 text-sm">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gold/15 text-gold">
        <Icon className="h-3.5 w-3.5" />
      </span>
      {label}
    </li>
  );
}

/** Verified business seller: full analytics dashboard. Unlocked once an admin approves business verification. */
function BusinessDashboard() {
  const {
    earned, pendingPayout, inEscrowTotal, activeCount, completedCount, disputedCount,
    recent, byWeekday, maxDay, isLoading, isError, refetch,
  } = useSellerStats();

  return (
    <div className="flex-1 overflow-y-auto pb-6">
      <SellerHeader subtitle="Here's how your store is performing." />

      {isError ? (
        <div className="mx-5 mt-5 lg:mx-0 lg:mt-6">
          <ErrorState description="Couldn't load your store data." onRetry={() => refetch()} />
        </div>
      ) : (
        <>
          <div className="mx-5 mt-5 overflow-hidden rounded-3xl border border-border/40 bg-gradient-card p-6 shadow-card lg:mx-0 lg:mt-6 lg:p-8">
            <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground">TOTAL EARNINGS</p>
            <p className="mt-2 text-4xl font-bold lg:text-5xl">{isLoading ? "…" : currency(earned)}</p>

            <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border/40 pt-4 lg:max-w-sm lg:gap-6 lg:pt-6">
              <div>
                <p className="text-[10px] tracking-wider text-muted-foreground">PENDING PAYOUT</p>
                <p className="mt-0.5 text-base font-bold text-gold lg:text-lg">{isLoading ? "…" : currency(pendingPayout)}</p>
              </div>
              <div>
                <p className="text-[10px] tracking-wider text-muted-foreground">IN ESCROW</p>
                <p className="mt-0.5 text-base font-bold lg:text-lg">{isLoading ? "…" : currency(inEscrowTotal)}</p>
              </div>
            </div>

            <button
              onClick={() => toast.info("Payouts to M-PESA are coming soon — your balance stays safely on ZUNO until then.")}
              className="mt-4 flex h-11 w-full items-center justify-center rounded-2xl bg-gradient-gold text-sm font-semibold text-gold-foreground shadow-gold transition-opacity hover:opacity-95 lg:w-auto lg:px-8"
            >
              Withdraw to M-PESA
            </button>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 px-4 sm:px-6 md:grid-cols-4 lg:mt-6 lg:gap-4 lg:px-0">
            <Stat icon={Package} label="Active orders" value={isLoading ? "…" : String(activeCount)} delta="in escrow" />
            <Stat icon={TrendingUp} label="Completed" value={isLoading ? "…" : String(completedCount)} delta="all time" />
            <Stat icon={Wallet} label="Pending payout" value={isLoading ? "…" : currency(pendingPayout)} delta="awaiting transfer" />
            <Stat icon={ShieldAlert} label="Disputed" value={isLoading ? "…" : String(disputedCount)} delta="all time" />
          </div>

          <div className="mt-7 px-4 sm:px-6 lg:mt-8 lg:px-0 xl:grid xl:grid-cols-5 xl:gap-8">
            <section className="min-w-0 xl:col-span-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold lg:text-lg">Sales overview</h2>
                <span className="text-xs text-muted-foreground lg:text-sm">By day of week</span>
              </div>
              <div className="mt-3 rounded-3xl border border-border/40 bg-surface p-5 lg:p-6">
                <div className="flex h-32 items-end gap-2 lg:h-48">
                  {byWeekday.map((amount, i) => (
                    <div key={i} className="flex-1">
                      <div className="rounded-t-lg bg-gradient-gold" style={{ height: `${Math.max(4, (amount / maxDay) * 100)}%` }} />
                    </div>
                  ))}
                </div>
                <div className="mt-2 grid grid-cols-7 gap-2 text-center text-[10px] text-muted-foreground lg:text-xs">
                  {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i}>{d}</span>)}
                </div>
              </div>
            </section>

            <section className="mt-7 min-w-0 xl:col-span-2 xl:mt-0">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold lg:text-lg">Recent activity</h2>
                <Link to="/seller/transactions" className="flex items-center gap-1 text-xs font-medium text-gold lg:text-sm">See all <ArrowUpRight className="h-3 w-3" /></Link>
              </div>
              {!isLoading && recent.length === 0 ? (
                <p className="mt-3 rounded-2xl border border-dashed border-border/60 bg-surface/40 px-4 py-6 text-center text-sm text-muted-foreground">
                  No sales yet.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {recent.map((t) => <RecentActivityRow key={t.id} t={t} />)}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, delta, up }: { icon: typeof TrendingUp; label: string; value: string; delta: string; up?: boolean }) {
  return (
    <div className="rounded-2xl border border-border/40 bg-surface p-4">
      <div className="flex items-center justify-between">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-gold/15 text-gold"><Icon className="h-4 w-4" /></span>
        <span className={`text-[10px] font-semibold ${up ? "text-success" : "text-muted-foreground"}`}>{delta}</span>
      </div>
      <p className="mt-3 text-lg font-bold">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

/** Shown only while a dispute needs the seller, so it is one tap from the home screen. */
function OpenDisputesBanner() {
  const { data: disputes } = useDisputes();
  const open = (disputes ?? []).filter((d) => d.status !== "resolved" && d.status !== "rejected");
  if (open.length === 0) return null;
  const first = open[0];
  return (
    <Link
      to={(open.length === 1 ? `/seller/dispute/${first.id}` : "/seller/disputes") as never}
      className="mx-4 mt-4 flex items-center gap-3 rounded-2xl sm:mx-6 border border-destructive/40 bg-destructive/10 p-4 lg:mx-0"
    >
      <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{open.length === 1 ? "A buyer opened a dispute" : `${open.length} open disputes`}</p>
        <p className="text-xs text-muted-foreground">Tap to reply, make an offer or add evidence.</p>
      </div>
    </Link>
  );
}
