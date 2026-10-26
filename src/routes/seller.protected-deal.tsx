import { createFileRoute, Link } from "@tanstack/react-router";
import { UserPlus, LogIn, ShieldCheck, Info } from "lucide-react";
import { TopBar } from "@/components/zuno/TopBar";

export const Route = createFileRoute("/seller/protected-deal")({
  head: () => ({ meta: [{ title: "Start a Protected Deal — ZUNO" }] }),
  component: SellerProtectedDealGate,
});

function SellerProtectedDealGate() {
  const REDIRECT = "/app/new-escrow";
  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <TopBar title="Start a Protected Deal" back="/seller/safepay" />
      <div className="flex flex-1 flex-col px-4 sm:px-6 pt-4 pb-8">
        <div className="rounded-3xl border border-border/40 bg-gradient-card p-6 shadow-card">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gold/15 text-gold">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="mt-3 text-xl font-bold leading-tight">
            Buyer account required
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Protected Deals are initiated from the buyer side. Log in with your Buyer account or create one to continue — we'll bring you right back here.
          </p>
        </div>

        <div className="mt-5 rounded-2xl border border-gold/30 bg-gold/5 p-4">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Your seller session stays active. Switching to buyer only starts the escrow — funds and delivery tracking are visible to both sides.
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          <Link
            to="/auth/login"
            search={{ redirect: REDIRECT } as never}
            className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-gradient-gold text-base font-semibold text-gold-foreground shadow-gold"
          >
            <LogIn className="h-5 w-5" /> Log in as Buyer
          </Link>
          <Link
            to="/auth/signup"
            onClick={() => {
              try {
                sessionStorage.setItem("zuno_post_auth_redirect", REDIRECT);
              } catch {}
            }}
            className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-border bg-surface text-base font-semibold"
          >
            <UserPlus className="h-5 w-5 text-gold" /> Create Buyer Account
          </Link>
        </div>

        <p className="mt-auto pt-6 text-center text-xs text-muted-foreground">
          After sign in or registration, you'll return to the Protected Deal creation flow automatically.
        </p>
      </div>
    </div>
  );
}
