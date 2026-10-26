import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { getAvatarInitial } from "@/lib/user-display";
import {
  ShieldCheck,
  ChevronRight,
  User,
  Bell,
  Lock,
  Landmark,
  HelpCircle,
  FileText,
  LogOut,
  BadgeCheck,
  Eye,
  Receipt,
  Pencil,
  Clock,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { TopBar } from "@/components/zuno/TopBar";
import { currency } from "@/lib/zuno-data";
import { useTransactions } from "@/hooks/queries/useTransactions";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { useSellerTier } from "@/lib/seller-business-verification";
import type { SellerVerificationTier } from "@/types/models";

export const Route = createFileRoute("/seller/account")({
  head: () => ({ meta: [{ title: "Seller Profile — ZUNO" }] }),
  component: SellerAccount,
});

function SellerAccount() {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const tier = useSellerTier();
  const { data: txs } = useTransactions();
  const deals = (txs ?? []).filter((x) => x.status === "Completed" || x.status === "Resolved");
  const earnedTotal = deals.reduce((sum, x) => sum + (x.sellerReceives ?? x.amount), 0);
  const isBusiness = tier === "verified";

  const handleLogout = async () => {
    await logout();
    toast.success("Logged out.");
    navigate({ to: "/" });
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto pb-6">
      <TopBar title="Seller Profile" back="/seller" />

      {/* Profile card */}
      <div className="mx-5 mt-4 rounded-3xl border border-border/40 bg-gradient-card p-5 shadow-card">
        <div className="flex items-center gap-4">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-gold text-2xl font-bold text-gold-foreground">
            {getAvatarInitial(user)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-lg font-semibold">{user?.name ?? "Seller"}</p>
              {isBusiness && <BadgeCheck className="h-4 w-4 text-gold" />}
            </div>
            <p className="truncate text-xs text-muted-foreground">{user?.email ?? "—"}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.phone ?? "—"}</p>
          </div>
          <Link
            to="/seller/settings"
            className="grid h-9 w-9 place-items-center rounded-xl bg-surface-2 text-gold"
            aria-label="Edit profile"
          >
            <Pencil className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border/40 pt-4 text-center">
          <div>
            <p className="text-base font-bold">{user?.trustScore ? user.trustScore.toFixed(1) : "—"}</p>
            <p className="text-[10px] text-muted-foreground">Rating</p>
          </div>
          <div>
            <p className="text-base font-bold">{deals.length}</p>
            <p className="text-[10px] text-muted-foreground">Deals</p>
          </div>
          <div>
            <p className="text-base font-bold">{currency(earnedTotal)}</p>
            <p className="text-[10px] text-muted-foreground">Earned</p>
          </div>
        </div>
      </div>

      {/* Verification banner */}
      <VerificationBanner tier={tier} />

      {/* Business / Account */}
      <Section title={isBusiness ? "Business" : "Account"}>
        <Row icon={User} label="Edit profile" to="/seller/settings" />
        <Row icon={Landmark} label="Linked bank & mobile money" to="/seller/settings" />
        <Row icon={Receipt} label="Transaction history" to="/seller/transactions" />
      </Section>

      {/* Preferences */}
      <Section title="Preferences">
        <Row icon={Bell} label="Notifications" to="/seller/notifications" />
        <Row icon={Lock} label="Security" to="/seller/settings" />
        <Row icon={Eye} label="Privacy" to="/seller/settings" />
      </Section>

      {/* ZUNO */}
      <Section title="ZUNO">
        <Row icon={ShieldCheck} label="SafePay protection" to="/seller/safepay" />

        <Row icon={HelpCircle} label="Help & support" to="/seller/help" />
        <Row icon={FileText} label="Terms & conditions" to="/terms" external />
      </Section>

      <div className="px-4 sm:px-6 pb-8 pt-6">
        <button
          onClick={handleLogout}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/15"
        >
          <LogOut className="h-4 w-4" /> {t("account_log_out")}
        </button>
        <p className="mt-4 text-center text-[11px] text-muted-foreground">ZUNO v1.0.0 · Seller</p>
      </div>
    </div>
  );
}

function VerificationBanner({ tier }: { tier: SellerVerificationTier }) {
  if (tier === "verified") {
    return (
      <Link
        to="/seller/verification"
        className="mx-5 mt-4 flex items-center gap-3 rounded-2xl border border-gold/30 bg-gold/5 p-4"
      >
        <ShieldCheck className="h-6 w-6 text-gold" />
        <div className="flex-1">
          <p className="text-sm font-semibold">Verification Status</p>
          <p className="text-xs text-muted-foreground">Business verified (Tier 2) · deals up to Ksh 1,000,000</p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>
    );
  }

  if (tier === "pending") {
    return (
      <Link to="/seller/verification" className="mx-5 mt-4 flex items-center gap-3 rounded-2xl border border-gold/30 bg-gold/5 p-4">
        <Clock className="h-6 w-6 text-gold" />
        <div className="flex-1">
          <p className="text-sm font-semibold">Verification in review</p>
          <p className="text-xs text-muted-foreground">Usually takes under 24 hours</p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>
    );
  }

  if (tier === "flagged") {
    return (
      <Link to="/seller/verification" className="mx-5 mt-4 flex items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
        <ShieldAlert className="h-6 w-6 text-destructive" />
        <div className="flex-1">
          <p className="text-sm font-semibold">Verification needs another look</p>
          <p className="text-xs text-muted-foreground">Tap to review and resubmit</p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>
    );
  }

  return (
    <Link to="/seller/verification" className="mx-5 mt-4 flex items-center gap-3 rounded-2xl border border-border/40 bg-surface p-4">
      <Sparkles className="h-6 w-6 text-gold" />
      <div className="flex-1">
        <p className="text-sm font-semibold">You're on the Basic plan</p>
        <p className="text-xs text-muted-foreground">Verify your business to unlock the Business dashboard</p>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </Link>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 px-4 sm:px-6">
      <p className="mb-2 px-2 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </p>
      <ul className="divide-y divide-border/40 overflow-hidden rounded-2xl border border-border/40 bg-surface">
        {children}
      </ul>
    </div>
  );
}

function Row({ icon: Icon, label, to, external }: { icon: typeof User; label: string; to: string; external?: boolean }) {
  const content = (
    <>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-gold">
        <Icon className="h-4 w-4" />
      </span>
      <span className="flex-1 text-sm font-medium">{label}</span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </>
  );
  return (
    <li>
      {external ? (
        <a href={to} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-3.5">
          {content}
        </a>
      ) : (
        <Link to={to} className="flex items-center gap-3 px-4 py-3.5">
          {content}
        </Link>
      )}
    </li>
  );
}
