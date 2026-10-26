import { createFileRoute, Link } from "@tanstack/react-router";
import { Shield, Lock, Truck, CheckCircle2, ArrowDown } from "lucide-react";
import zunoLogo from "@/assets/zuno-logo-new.png";
import { TopBar } from "@/components/zuno/TopBar";

export const Route = createFileRoute("/app/safepay")({
  head: () => ({ meta: [{ title: "SafePay Protection — ZUNO" }] }),
  component: () => <SafePayPage backTo="/app" />,
});

export function SafePayPage({ backTo = "/app", startHref = "/app/new-escrow" }: { backTo?: string; startHref?: string }) {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <TopBar title="SafePay Protection" back={backTo} />


      <div className="px-4 sm:px-6 pt-4 pb-8">
        <div className="overflow-hidden rounded-3xl border border-border/40 bg-gradient-card p-6 shadow-elevated">
          <div className="mx-auto grid h-24 w-24 place-items-center">
            <img src={zunoLogo} alt="ZUNO" className="h-full w-full object-contain" />
          </div>

          <h1 className="mt-5 text-center text-2xl font-bold leading-tight">
            Pay only when you <span className="text-gold">trust delivery.</span>
          </h1>
          <p className="mt-3 text-center text-sm text-muted-foreground">
            Every ZUNO transaction is shielded by SafePay — escrow built for marketplace deals across Africa.
          </p>
        </div>

        <p className="mt-8 px-1 text-xs font-bold tracking-[0.18em] text-muted-foreground">HOW IT WORKS</p>
        <ol className="mt-3 space-y-3">
          <Step n={1} icon={Lock} title="Buyer pays into escrow" desc="Funds are held by ZUNO, never sent to the seller yet." />
          <Connector />
          <Step n={2} icon={Shield} title="ZUNO holds the payment" desc="Encrypted, audited, regulated. Seller can see funds are confirmed." />
          <Connector />
          <Step n={3} icon={Truck} title="Seller ships & delivers" desc="You can track every step inside the app." />
          <Connector />
          <Step n={4} icon={CheckCircle2} title="You confirm — funds released" desc="If something's wrong, open a dispute. Refunds are protected." gold />
        </ol>

        <Link
          to={startHref}
          className="mt-8 flex h-14 items-center justify-center rounded-2xl bg-gradient-gold text-base font-semibold text-gold-foreground shadow-gold"
        >
          Start a protected deal
        </Link>
      </div>
    </div>
  );
}

function Step({ n, icon: Icon, title, desc, gold }: { n: number; icon: typeof Lock; title: string; desc: string; gold?: boolean }) {
  return (
    <li className={`grid grid-cols-[auto_1fr] items-start gap-4 rounded-2xl border p-4 ${gold ? "border-gold/40 bg-gold/5" : "border-border/40 bg-surface"}`}>
      <div className={`grid h-12 w-12 place-items-center rounded-2xl ${gold ? "bg-gradient-gold text-gold-foreground" : "bg-gradient-violet text-gold"}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xs font-bold tracking-wider text-muted-foreground">STEP {n}</p>
        <p className="mt-0.5 text-sm font-semibold">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{desc}</p>
      </div>
    </li>
  );
}

function Connector() {
  return (
    <li className="flex justify-center">
      <ArrowDown className="h-4 w-4 text-muted-foreground" />
    </li>
  );
}
