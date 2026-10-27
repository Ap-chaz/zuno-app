import { createFileRoute, Link } from "@tanstack/react-router";
import { getAvatarInitial, getFirstName } from "@/lib/user-display";
import { Bell, PlayCircle, ArrowUpRight, ArrowDownRight, ShieldCheck, Package, FilePlus, Inbox, AlertTriangle } from "lucide-react";
import { Logo } from "@/components/zuno/Logo";
import { ThemeToggle } from "@/components/zuno/ThemeToggle";
import { EmptyState, ListSkeleton } from "@/components/common/StateViews";
import { useDisputes } from "@/hooks/queries/useDisputes";
import { useActiveTransactions, useTransactions } from "@/hooks/queries/useTransactions";
import { useUnreadNotificationCount } from "@/hooks/queries/useNotifications";
import { formatCurrency, statusColorClass } from "@/services/transactions.service";
import { useHideBalances } from "@/hooks/useHideBalances";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import type { Transaction } from "@/types/models";

export const Route = createFileRoute("/app/")({
  head: () => ({ meta: [{ title: "Home — ZUNO" }] }),
  component: Home,
});

/** Dashboard shows a preview only; the full list lives on /app/track. */
const MAX_ACTIVE_PREVIEW = 4;

function timeOfDayGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function Home() {
  const { user } = useAuth();
  const { mask } = useHideBalances();
  const { t } = useLanguage();
  const { data: activeOrders, isLoading: loadingActive } = useActiveTransactions();
  const { data: transactions, isLoading: loadingRecent } = useTransactions();
  const { data: unreadCount } = useUnreadNotificationCount();
  const { data: disputes } = useDisputes();
  const hasOpenDispute = (disputes ?? []).some((d) => d.status !== "resolved" && d.status !== "rejected");
  const recent = (transactions ?? []).slice(0, 3);
  const protectedTotal = (activeOrders ?? []).reduce((sum, t) => sum + t.amount, 0);
  const firstName = getFirstName(user);

  return (
    <div className="flex-1 overflow-y-auto pb-6">
      {/* Header — logo shown only on mobile (sidebar already carries the brand on desktop) */}
      <header className="flex items-center justify-between px-4 pt-6 sm:px-6 lg:px-0 lg:pt-0">
        <div className="lg:hidden">
          <Logo />
        </div>
        <div className="hidden lg:block">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            {timeOfDayGreeting()}, {firstName} 👋
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Here's what's happening with your escrow deals.</p>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            to="/app/notifications"
            className="relative grid h-10 w-10 place-items-center rounded-full bg-surface transition-colors hover:bg-surface-2"
            aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
          >
            <Bell className="h-5 w-5 text-gold" />
            {Boolean(unreadCount) && (
              <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">
                {unreadCount && unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </Link>
          <Link
            to="/app/account"
            className="grid h-10 w-10 place-items-center rounded-full bg-gradient-gold text-sm font-bold text-gold-foreground"
            aria-label="Account"
          >
            {getAvatarInitial(user)}
          </Link>
        </div>
      </header>

      <p className="mt-5 px-4 text-sm text-muted-foreground sm:px-6 lg:hidden">
        {timeOfDayGreeting()}, {firstName} 👋
      </p>

      {/* Balance card */}
      <section className="mx-4 mt-3 overflow-hidden rounded-3xl border border-border/40 bg-gradient-card p-5 shadow-card sm:mx-6 sm:p-6 lg:mx-0 lg:mt-6 lg:p-8">
        <div className="relative">
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gold/15 blur-3xl" />
          <div className="absolute -bottom-16 left-6 h-32 w-32 rounded-full bg-accent/25 blur-3xl" />

          <div className="relative flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-muted-foreground">
            {t("home_protected_in_escrow").toUpperCase()}
          </div>
          <p className="relative mt-3 break-words text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">{mask(formatCurrency(protectedTotal))}</p>

          <div className="relative mt-5 grid grid-cols-3 gap-2 border-t border-border/40 pt-4 sm:mt-6 sm:gap-3 lg:mt-8 lg:max-w-md lg:gap-6 lg:pt-6">
            <Stat label={t("home_trust_score")} value={`${user?.trustScore ?? 0} / 1000`} />
            <Stat label={t("home_active")} value={`${activeOrders?.length ?? 0} deals`} />
            <Stat label={t("home_completed")} value={`${(transactions ?? []).filter((tx) => tx.status === "Completed").length}`} />
          </div>
        </div>
      </section>

      {/* Quick actions */}
      <section className="mt-6 grid grid-cols-4 gap-3 px-4 sm:gap-4 sm:px-6 lg:mt-6 lg:px-0">
        <Action to="/app/new-escrow" icon={FilePlus} label="New escrow" />
        <Action to="/app/disputes" icon={AlertTriangle} label="Disputes" dot={hasOpenDispute} />
        <Action to="/app/safepay" icon={ShieldCheck} label="SafePay" />
        <Action to="/app/demo" icon={PlayCircle} label="Demo" />
      </section>

      {/* Main content: active orders + recent transactions become a two-column
          dashboard layout on wide screens instead of one long mobile-style stack. */}
      <div className="mt-7 px-4 sm:px-6 lg:mt-8 lg:px-0 xl:grid xl:grid-cols-5 xl:gap-8">
        <section className="min-w-0 xl:col-span-3">
          <SectionHeader title={t("home_active_orders")} to="/app/track" seeAllLabel={t("home_see_all")} />
          {loadingActive ? (
            <ListSkeleton rows={2} className="mt-3" />
          ) : (activeOrders?.length ?? 0) === 0 ? (
            <div className="mt-3">
              <EmptyState icon={Package} title="No active orders" description="Start a new escrow deal to see it here." />
            </div>
          ) : (
            <>
              <ul className="mt-3 space-y-2">
                {activeOrders!.slice(0, MAX_ACTIVE_PREVIEW).map((order) => (
                  <ActivityCard key={order.id} t={order} />
                ))}
              </ul>
              {activeOrders!.length > MAX_ACTIVE_PREVIEW && (
                <Link
                  to="/app/track"
                  className="mt-3 block rounded-2xl border border-border/40 bg-surface py-3 text-center text-sm font-semibold text-gold transition-colors hover:bg-surface-2"
                >
                  View all {activeOrders!.length} active orders
                </Link>
              )}
            </>
          )}
        </section>

        <section className="mt-7 min-w-0 xl:col-span-2 xl:mt-0">
          <SectionHeader title={t("home_recent_transactions")} to="/app/transactions" seeAllLabel={t("home_see_all")} />
          {loadingRecent ? (
            <ListSkeleton rows={3} className="mt-3" />
          ) : recent.length === 0 ? (
            <div className="mt-3">
              <EmptyState icon={Inbox} title="No transactions yet" description="Your escrow payments will appear here." />
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-border/40 rounded-3xl border border-border/40 bg-surface max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent">
              {recent.map((tx) => (
                <li key={tx.id}>
                  <TransactionRow order={tx} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/** List row: icon, item and seller · date, amount with a status badge. */
function TransactionRow({ order }: { order: Transaction }) {
  return (
    <Link
      to="/app/transaction/$id"
      params={{ id: order.id }}
      className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2 active:bg-surface-2"
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-surface-2 text-lg">📱</span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{order.item}</p>
        <p className="truncate text-xs text-muted-foreground">
          {order.seller} · {order.date}
        </p>
      </div>
      <div className="min-w-0 max-w-[9rem] text-right">
        <p className="text-sm font-bold">{formatCurrency(order.amount)}</p>
        <span className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusColorClass(order.status)}`}>
          {order.status}
        </span>
      </div>
    </Link>
  );
}

/** Card: same look as the seller's Recent activity (separate card, round arrow icon, plain status text). */
function ActivityCard({ t }: { t: Transaction }) {
  const up = t.status !== "Refunded";
  return (
    <li>
      <Link
        to="/app/transaction/$id"
        params={{ id: t.id }}
        className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-border/40 bg-surface p-3.5 transition-colors hover:bg-surface-2"
      >
        <span className={`grid h-10 w-10 place-items-center rounded-2xl ${up ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
          {up ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{t.item}</p>
          <p className="truncate text-xs text-muted-foreground">{t.seller}</p>
        </div>
        <div className="min-w-0 max-w-[9rem] text-right">
          <p className={`text-sm font-bold ${up ? "" : "text-destructive"}`}>{formatCurrency(t.amount)}</p>
          <p className="text-[10px] text-muted-foreground">{t.status}</p>
        </div>
      </Link>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] text-muted-foreground lg:text-xs">{label}</p>
      <p className="mt-0.5 truncate text-sm font-bold lg:text-base">{value}</p>
    </div>
  );
}

function Action({ to, icon: Icon, label, dot }: { to: string; icon: typeof FilePlus; label: string; dot?: boolean }) {
  return (
    <Link
      to={to}
      className="flex flex-col items-center gap-2 rounded-full lg:flex-row lg:justify-center lg:gap-3 lg:border lg:border-border/40 lg:bg-surface lg:px-4 lg:py-3 lg:transition-colors lg:hover:border-gold/40 lg:hover:bg-surface-2"
    >
      <span className="relative grid h-14 w-14 place-items-center rounded-full border border-border/40 bg-surface text-gold transition-colors hover:bg-surface-2 lg:h-10 lg:w-10 lg:shrink-0 lg:border-0 lg:bg-gold/15 lg:hover:bg-gold/25">
        <Icon className="h-5 w-5" />
        {dot && <span className="absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-background bg-destructive" aria-label="Needs attention" />}
      </span>
      <span className="text-[11px] font-medium text-muted-foreground lg:text-sm lg:font-semibold lg:text-foreground">{label}</span>
    </Link>
  );
}

function SectionHeader({ title, to, params, seeAllLabel = "See all" }: { title: string; to: string; params?: Record<string, string>; seeAllLabel?: string }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-base font-bold lg:text-lg">{title}</h2>
      <Link to={to} params={params} className="flex items-center gap-1 text-xs font-medium text-gold lg:text-sm">
        {seeAllLabel} <ArrowUpRight className="h-3 w-3" />
      </Link>
    </div>
  );
}
