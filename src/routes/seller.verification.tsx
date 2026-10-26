import { createFileRoute, Link } from "@tanstack/react-router";
import { BadgeCheck, ShieldCheck, Mail } from "lucide-react";
import { TopBar } from "@/components/zuno/TopBar";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/seller/verification")({
  head: () => ({ meta: [{ title: "Business Verification — ZUNO Seller" }] }),
  component: SellerVerification,
});

const fmt = (n: number) => `Ksh ${n.toLocaleString("en-KE")}`;

/**
 * Levels are set by a ZUNO admin after checking documents. Nothing on this page can change them,
 * so it only shows the real level and how to move up.
 */
function SellerVerification() {
  const { user } = useAuth();
  const tier = user?.sellerTier ?? 0;
  const levels = [
    { n: 0, name: "Starter", limit: 1000, note: "Phone verified. Small deals only." },
    { n: 1, name: "Verified seller", limit: 50000, note: "Your ID and selfie were approved." },
    { n: 2, name: "Verified business", limit: 1000000, note: "Business registration and KRA PIN checked by ZUNO." },
  ];
  return (
    <div className="flex flex-1 flex-col overflow-y-auto pb-8">
      <TopBar title="Verification level" back="/seller/account" />
      <div className="space-y-3 px-4 sm:px-6 pt-4">
        {levels.map((l) => (
          <div key={l.n}
            className={`rounded-3xl border p-4 ${tier === l.n ? "border-gold/50 bg-gold/5" : "border-border/40 bg-surface"}`}>
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 font-semibold">
                {tier >= l.n ? <BadgeCheck className="h-4 w-4 text-gold" /> : <ShieldCheck className="h-4 w-4 text-muted-foreground" />}
                {l.name}
              </p>
              {tier === l.n && <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-semibold text-gold">Your level</span>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{l.note}</p>
            <p className="mt-2 text-sm font-bold">Deals up to {fmt(l.limit)}</p>
          </div>
        ))}

        {tier < 1 && (
          <Link to="/auth/kyc" className="flex h-12 items-center justify-center rounded-2xl bg-gradient-gold text-sm font-semibold text-gold-foreground shadow-gold">
            Verify your ID to reach Verified seller
          </Link>
        )}
        {tier === 1 && (
          <div className="rounded-3xl border border-border/40 bg-surface p-4 text-sm">
            <p className="flex items-center gap-2 font-semibold"><Mail className="h-4 w-4 text-gold" /> Move up to Verified business</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Contact ZUNO support with your business registration certificate and KRA PIN. An admin reviews them and upgrades your level.
            </p>
            <Link to="/seller/help" className="mt-3 inline-block text-xs font-semibold text-gold underline">Contact support</Link>
          </div>
        )}
      </div>
    </div>
  );
}
