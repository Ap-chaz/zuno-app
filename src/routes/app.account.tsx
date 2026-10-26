import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { getAvatarInitial } from "@/lib/user-display";
import { ShieldCheck, ChevronRight, User, Bell, Lock, CreditCard, HelpCircle, LogOut, BadgeCheck } from "lucide-react";
import { toast } from "sonner";
import { TopBar } from "@/components/zuno/TopBar";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { useTransactions } from "@/hooks/queries/useTransactions";

export const Route = createFileRoute("/app/account")({
  head: () => ({ meta: [{ title: "Account — ZUNO" }] }),
  component: Account,
});

function Account() {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const { data: transactions } = useTransactions();
  const navigate = useNavigate();
  const completedDeals = (transactions ?? []).filter((t) => t.status === "Completed").length;

  const handleLogout = async () => {
    await logout();
    toast.success("Logged out.");
    navigate({ to: "/" });
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <TopBar title={t("account_title")} />

      <div className="mx-5 mt-4 rounded-3xl border border-border/40 bg-gradient-card p-5 shadow-card">
        <div className="flex items-center gap-4">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-gold text-2xl font-bold text-gold-foreground">
            {getAvatarInitial(user)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-lg font-semibold">{user?.name ?? "Guest"}</p>
              {user?.kycStatus === "verified" && <BadgeCheck className="h-4 w-4 text-gold" />}
            </div>
            <p className="truncate text-xs text-muted-foreground">{user?.phone ?? user?.email ?? "Not signed in"}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border/40 pt-4 text-center">
          <div>
            <p className="text-base font-bold">{user?.trustScore ?? 0}</p>
            <p className="text-[10px] text-muted-foreground">{t("home_trust_score")}</p>
          </div>
          <div>
            <p className="text-base font-bold">{transactions?.length ?? 0}</p>
            <p className="text-[10px] text-muted-foreground">{t("account_deals")}</p>
          </div>
          <div>
            <p className="text-base font-bold">{completedDeals}</p>
            <p className="text-[10px] text-muted-foreground">{t("account_completed")}</p>
          </div>
        </div>
      </div>

      <Link to="/app/verification" className="mx-5 mt-4 flex items-center gap-3 rounded-2xl border border-gold/30 bg-gold/5 p-4 transition-colors hover:bg-gold/10">
        <ShieldCheck className="h-6 w-6 text-gold" />
        <div className="flex-1">
          <p className="text-sm font-semibold">Verification Center</p>
          <p className="text-xs text-muted-foreground">
            {user?.kycStatus === "verified" ? "Identity verified" : user?.kycStatus === "pending" ? "Verification pending" : "Not yet verified"}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>

      <Section title="Account">
        <Row icon={User} label="Profile settings" to="/app/settings" />
        <Row icon={CreditCard} label="Payment methods" to="/app/settings" />
        <Row icon={Lock} label="Security & privacy" to="/app/settings" />
        <Row icon={Bell} label="Notifications" to="/app/notifications" />
      </Section>

      <Section title="ZUNO">
        <Row icon={ShieldCheck} label="SafePay protection" to="/app/safepay" />
        <Row icon={HelpCircle} label="Help & support" to="/help" />
      </Section>

      <div className="px-4 sm:px-6 pb-8 pt-6">
        <button
          onClick={handleLogout}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/15"
        >
          <LogOut className="h-4 w-4" /> {t("account_log_out")}
        </button>
        <p className="mt-4 text-center text-[11px] text-muted-foreground">ZUNO v1.0.0 · Made with care</p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 px-4 sm:px-6">
      <p className="mb-2 px-2 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{title}</p>
      <ul className="divide-y divide-border/40 overflow-hidden rounded-2xl border border-border/40 bg-surface">{children}</ul>
    </div>
  );
}

function Row({ icon: Icon, label, to }: { icon: typeof User; label: string; to: string }) {
  return (
    <li>
      <Link to={to} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-gold">
          <Icon className="h-4 w-4" />
        </span>
        <span className="flex-1 text-sm font-medium">{label}</span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>
    </li>
  );
}
