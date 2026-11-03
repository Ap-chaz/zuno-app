import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ShieldCheck,
  AlertTriangle,
  Receipt,
  Wallet,
  BarChart3,
  Users,
  LogOut,
  Clock,
  TrendingUp,
  BadgeCheck,
  LifeBuoy,
  Bell,
  ChevronRight,
  ShieldAlert,
} from "lucide-react";
import { PhoneFrame } from "@/components/zuno/PhoneFrame";
import { TopBar } from "@/components/zuno/TopBar";
import { ThemeToggle } from "@/components/zuno/ThemeToggle";
import { adminLogout } from "@/lib/admin-auth";
import { useAdminMetrics } from "@/hooks/queries/useAdmin";
import { formatCurrency } from "@/services/transactions.service";

export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: "Admin Command Center — ZUNO" }] }),
  component: AdminHome,
});

function AdminHome() {
  const { data: m, isLoading } = useAdminMetrics();
  const stats = {
    pendingVerifications: m?.pendingKyc ?? 0,
    openDisputes: m?.openDisputes ?? 0,
    totalVolume: m?.inEscrow ?? 0,
    estRevenue: m?.revenue ?? 0,
    disputedDeals: m?.disputed ?? 0,
  };

  return (
    <PhoneFrame>
      <TopBar
        title="ZUNO Admin"
        back="/app/account"
        right={
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => {
                adminLogout();
                window.location.reload();
              }}
              className="grid h-10 w-10 place-items-center rounded-xl bg-surface text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
              aria-label="Log out of admin"
              title="Sign out of Admin"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        }
      />

      <div className="px-5 pt-4 pb-12">
        {/* Header subtitle / status pill */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-4">
          <div>
            <h1 className="text-lg font-bold text-foreground">Operations Command Center</h1>
            <p className="text-xs text-muted-foreground">
              Internal tools for reviewing sellers, escrow funds, and dispute adjudication.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-xs font-semibold text-gold">
            <span className="h-2 w-2 rounded-full bg-gold animate-pulse" />
            Admin Live
          </span>
        </div>

        {/* Metrics Cards: Responsive 2 to 5 columns */}
        <div className="mb-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
          <StatCard
            icon={TrendingUp}
            label="Held in escrow"
            value={isLoading ? "—" : formatCurrency(stats.totalVolume)}
            accent="gold"
          />
          <StatCard
            icon={ShieldCheck}
            label="Pending KYC"
            value={isLoading ? "—" : String(stats.pendingVerifications)}
            accent={stats.pendingVerifications > 0 ? "gold" : "muted"}
            badge={stats.pendingVerifications > 0 ? "Needs Review" : undefined}
          />
          <StatCard
            icon={AlertTriangle}
            label="Open disputes"
            value={isLoading ? "—" : String(stats.openDisputes)}
            accent={stats.openDisputes > 0 ? "destructive" : "muted"}
            badge={stats.openDisputes > 0 ? "Urgent" : undefined}
          />
          <StatCard
            icon={Wallet}
            label="Fee revenue"
            value={isLoading ? "—" : formatCurrency(stats.estRevenue)}
            accent="success"
          />
          <StatCard
            icon={Clock}
            label="Disputed deals"
            value={isLoading ? "—" : String(stats.disputedDeals)}
            accent={stats.disputedDeals > 0 ? "destructive" : "muted"}
          />
        </div>

        {/* Section 1: Core Operations & Queues */}
        <div className="mb-6">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Core Operations & Queues
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <AdminActionCard
              to="/admin/kyc"
              icon={ShieldCheck}
              title="KYC Review Queue"
              desc="Approve or reject seller identity & business documents"
              countBadge={stats.pendingVerifications > 0 ? `${stats.pendingVerifications} pending` : undefined}
              badgeVariant="gold"
            />
            <AdminActionCard
              to="/admin/disputes"
              icon={AlertTriangle}
              title="Dispute Resolution Center"
              desc="Review evidence and decide refund vs. release for open disputes"
              countBadge={stats.openDisputes > 0 ? `${stats.openDisputes} open` : undefined}
              badgeVariant="destructive"
            />
            <AdminActionCard
              to="/admin/transactions"
              icon={Receipt}
              title="Transaction Monitoring"
              desc="Search and filter every escrow deal on the platform"
            />
            <AdminActionCard
              to="/admin/payouts"
              icon={Wallet}
              title="Payout & Refund Queue"
              desc="Watch automatic M-Pesa payouts and retry failed settlements"
            />
          </div>
        </div>

        {/* Section 2: Accounts & Directory */}
        <div className="mb-6">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Accounts & Directory
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <AdminActionCard
              to="/admin/seller-accounts"
              icon={BadgeCheck}
              title="Seller Accounts"
              desc="Full directory, search by category, suspend or reinstate"
            />
            <AdminActionCard
              to="/admin/buyers"
              icon={Users}
              title="Buyer Accounts"
              desc="Search buyers, view transaction history, suspend or reinstate"
            />
          </div>
        </div>

        {/* Section 3: Platform Insights & Support */}
        <div>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Platform Insights & Support
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <AdminActionCard
              to="/admin/analytics"
              icon={BarChart3}
              title="Analytics Dashboard"
              desc="Volume trends, status breakdown, and top performing sellers"
            />
            <AdminActionCard
              to="/admin/support"
              icon={LifeBuoy}
              title="Support Tickets"
              desc="See customer support inquiries and mark issues resolved"
            />
            <AdminActionCard
              to="/admin/notifications"
              icon={Bell}
              title="Broadcast Notifications"
              desc="Manually send system push notifications and inspect logs"
            />
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent = "muted",
  badge,
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: string;
  accent?: "gold" | "destructive" | "success" | "muted";
  badge?: string;
}) {
  const accentClass = {
    gold: "text-gold",
    destructive: "text-destructive",
    success: "text-success",
    muted: "text-foreground",
  }[accent];

  return (
    <div className="relative rounded-2xl border border-border/60 bg-surface p-4 transition-all hover:border-gold/30 hover:shadow-sm">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon className="h-3.5 w-3.5" /> {label}
        </p>
        {badge && (
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
            {badge}
          </span>
        )}
      </div>
      <p className={`mt-2 text-xl font-bold tracking-tight ${accentClass}`}>{value}</p>
    </div>
  );
}

function AdminActionCard({
  to,
  icon: Icon,
  title,
  desc,
  countBadge,
  badgeVariant = "gold",
}: {
  to: string;
  icon: typeof ShieldCheck;
  title: string;
  desc: string;
  countBadge?: string;
  badgeVariant?: "gold" | "destructive";
}) {
  const badgeColors = {
    gold: "bg-gold/15 text-gold border-gold/30",
    destructive: "bg-destructive/15 text-destructive border-destructive/30",
  }[badgeVariant];

  return (
    <Link
      to={to}
      className="group flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-surface p-4 transition-all hover:border-gold/40 hover:bg-surface-2/40 hover:shadow-sm"
    >
      <div className="flex min-w-0 items-center gap-3.5">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gold/10 text-gold transition-colors group-hover:bg-gold/20">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground group-hover:text-primary">
              {title}
            </p>
            {countBadge && (
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${badgeColors}`}>
                {countBadge}
              </span>
            )}
          </div>
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{desc}</p>
        </div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
    </Link>
  );
}
