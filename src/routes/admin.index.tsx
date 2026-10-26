import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, AlertTriangle, Receipt, Wallet, BarChart3, Users, LogOut, Clock, TrendingUp, BadgeCheck, LifeBuoy, Bell } from "lucide-react";
import { PhoneFrame } from "@/components/zuno/PhoneFrame";
import { TopBar } from "@/components/zuno/TopBar";
import { AdminGate } from "@/components/zuno/AdminGate";
import { adminLogout } from "@/lib/admin-auth";
import { useAdminMetrics } from "@/hooks/queries/useAdmin";
import { formatCurrency } from "@/services/transactions.service";


export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: "Admin — ZUNO" }] }),
  component: () => (
    <AdminGate>
      <AdminHome />
    </AdminGate>
  ),
});

function AdminHome() {
  const { data: m } = useAdminMetrics();
  const stats = {
    pendingVerifications: m?.pendingKyc ?? 0,
    openDisputes: m?.openDisputes ?? 0,
    totalVolume: m?.inEscrow ?? 0,
    estRevenue: m?.revenue ?? 0,
    payoutsOwed: m?.disputed ?? 0,
  };

  return (
    <PhoneFrame>
      <TopBar
        title="ZUNO Admin"
        back="/app/account"
        right={
          <button
            type="button"
            onClick={() => {
              adminLogout();
              window.location.reload();
            }}
            className="grid h-10 w-10 place-items-center rounded-xl bg-surface text-muted-foreground hover:bg-surface-2"
            aria-label="Log out of admin"
          >
            <LogOut className="h-4 w-4" />
          </button>
        }
      />

      <div className="px-5 pt-4 pb-8">
        <p className="mb-3 text-xs text-muted-foreground">
          Internal tools for reviewing sellers and resolving disputes. Not visible to buyers or
          sellers.
        </p>

        <div className="mb-5 grid grid-cols-2 gap-3">
          <StatCard
            icon={ShieldCheck}
            label="Pending verifications"
            value={String(stats.pendingVerifications)}
            accent={stats.pendingVerifications > 0 ? "gold" : "muted"}
          />
          <StatCard
            icon={AlertTriangle}
            label="Open disputes"
            value={String(stats.openDisputes)}
            accent={stats.openDisputes > 0 ? "destructive" : "muted"}
          />
          <StatCard icon={TrendingUp} label="Held in escrow" value={formatCurrency(stats.totalVolume)} accent="muted" />
          <StatCard icon={Wallet} label="Fee revenue" value={formatCurrency(stats.estRevenue)} accent="success" />
          <StatCard
            icon={Clock}
            label="Disputed deals"
            value={String(stats.payoutsOwed)}
            accent={stats.payoutsOwed > 0 ? "destructive" : "muted"}
            wide
          />
        </div>

        <div className="space-y-3">
          <AdminLink
            to="/admin/kyc"
            icon={ShieldCheck}
            title="KYC Review Queue"
            desc="Approve or reject seller identity documents"
          />
          <AdminLink
            to="/admin/disputes"
            icon={AlertTriangle}
            title="Dispute Resolution Center"
            desc="Review evidence and decide refund vs. release for open disputes"
          />
          <AdminLink
            to="/admin/transactions"
            icon={Receipt}
            title="Transaction Monitoring"
            desc="Search and filter every deal on the platform"
          />
          <AdminLink
            to="/admin/payouts"
            icon={Wallet}
            title="Payout & Refund Queue"
            desc="Watch automatic M-Pesa payouts; retry failed ones"
          />
          <AdminLink
            to="/admin/buyers"
            icon={Users}
            title="Buyer Accounts"
            desc="Search buyers, view activity, suspend or reinstate"
          />
          <AdminLink
            to="/admin/kyc"
            icon={BadgeCheck}
            title="KYC & Compliance"
            desc="Approve or reject pending buyer identity verification"
          />
          <AdminLink
            to="/admin/support"
            icon={LifeBuoy}
            title="Support Tickets"
            desc="See who's contacted support and mark issues resolved"
          />
          <AdminLink
            to="/admin/notifications"
            icon={Bell}
            title="Notifications"
            desc="Manually send a notification and see recent sends"
          />
          <AdminLink
            to="/admin/analytics"
            icon={BarChart3}
            title="Analytics Dashboard"
            desc="Volume trends, status breakdown, top sellers"
          />
          <AdminLink
            to="/admin/seller-accounts"
            icon={ShieldCheck}
            title="Seller Accounts"
            desc="Full directory, search, suspend or reinstate"
          />
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
  wide = false,
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: string;
  accent?: "gold" | "destructive" | "success" | "muted";
  wide?: boolean;
}) {
  const accentClass = {
    gold: "text-gold",
    destructive: "text-destructive",
    success: "text-success",
    muted: "text-foreground",
  }[accent];

  return (
    <div className={`rounded-2xl border border-border/40 bg-surface p-3 ${wide ? "col-span-2" : ""}`}>
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </p>
      <p className={`mt-1 text-lg font-bold ${accentClass}`}>{value}</p>
    </div>
  );
}

function AdminLink({
  to,
  icon: Icon,
  title,
  desc,
  disabled = false,
}: {
  to: string;
  icon: typeof ShieldCheck;
  title: string;
  desc: string;
  disabled?: boolean;
}) {
  const content = (
    <>
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gold/10 text-gold">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{desc}</p>
      </div>
    </>
  );

  if (disabled) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-border/40 bg-surface p-4 opacity-50">
        {content}
      </div>
    );
  }

  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-2xl border border-border/40 bg-surface p-4 transition-colors hover:border-gold/30"
    >
      {content}
    </Link>
  );
}
