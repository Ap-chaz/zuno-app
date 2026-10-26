import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Store, LayoutDashboard, Truck, Wallet, Inbox, AlertTriangle, LayoutGrid, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import { useDisputes } from "@/hooks/queries/useDisputes";
import { useLanguage } from "@/hooks/useLanguage";
import type { TranslationKey } from "@/lib/i18n/translations";

export type NavItem = { to: string; labelKey: TranslationKey; icon: ComponentType<{ className?: string }>; matchPrefix?: string };

export const buyerNavItems: NavItem[] = [
  { to: "/app", labelKey: "nav_home", icon: Home },
  { to: "/app/sellers", labelKey: "nav_sellers", icon: Store },
  { to: "/app/track", labelKey: "nav_tracking", icon: Truck, matchPrefix: "/app/track" },
  { to: "/app/disputes", labelKey: "nav_disputes", icon: AlertTriangle, matchPrefix: "/app/dispute" },
];

export const sellerNavItems: NavItem[] = [
  { to: "/seller", labelKey: "nav_overview", icon: LayoutDashboard },
  { to: "/seller/contracts", labelKey: "nav_requests", icon: Inbox },
  { to: "/seller/deliveries", labelKey: "nav_orders", icon: Truck },
  { to: "/seller/transactions", labelKey: "nav_payouts", icon: Wallet },
  { to: "/seller/disputes", labelKey: "nav_disputes", icon: AlertTriangle, matchPrefix: "/seller/dispute" },
];

// Back-compat aliases used within this file.
const buyerItems = buyerNavItems;
const sellerItems = sellerNavItems;

function isItemActive(pathname: string, { to, matchPrefix }: NavItem) {
  const prefix = matchPrefix || to;
  if (to === "/app" || to === "/seller") return pathname === to;
  return pathname === to || pathname.startsWith(prefix);
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const { t } = useLanguage();
  const Icon = item.icon;
  const isActive = isItemActive(pathname, item);
  return (
    <Link
      to={item.to}
      aria-current={isActive ? "page" : undefined}
      className={`flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium transition-colors ${
        isActive ? "text-gold" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <span className={`grid h-9 w-9 place-items-center rounded-xl transition-all ${isActive ? "bg-gold/15" : ""}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="max-w-full truncate">{t(item.labelKey)}</span>
    </Link>
  );
}

/**
 * Seller phone layout: two tabs and a middle button that opens the rest (Orders, Payouts, Disputes).
 * The middle button shows a red dot while a dispute is open, so nothing important hides behind it.
 */
function SellerBottomNav({ pathname }: { pathname: string }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const { data: disputes } = useDisputes();
  const hasOpenDispute = (disputes ?? []).some((d) => d.status !== "resolved" && d.status !== "rejected");
  const primary = sellerNavItems.slice(0, 2);
  const more = sellerNavItems.slice(2);
  const moreActive = more.some((i) => isItemActive(pathname, i));

  useEffect(() => setOpen(false), [pathname]);

  return (
    <nav aria-label="Seller navigation" className="sticky bottom-0 z-30 mt-auto w-full border-t border-border/60 bg-surface/95 px-2 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl sm:px-4">
      {open && <button aria-label="Close menu" className="fixed inset-0 z-30 bg-black/40" onClick={() => setOpen(false)} />}
      {open && (
        <div className="absolute bottom-[calc(100%+0.5rem)] left-1/2 z-40 w-[min(20rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-3xl border border-border/60 bg-surface p-2 shadow-card">
          {more.map((item) => {
            const Icon = item.icon;
            const active = isItemActive(pathname, item);
            const showDot = item.to === "/seller/disputes" && hasOpenDispute;
            return (
              <Link key={item.to} to={item.to}
                className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold ${active ? "bg-gold/15 text-gold" : "hover:bg-surface-2"}`}>
                <Icon className="h-5 w-5" aria-hidden="true" />
                <span className="flex-1">{t(item.labelKey)}</span>
                {showDot && <span className="h-2.5 w-2.5 rounded-full bg-destructive" aria-label="Needs attention" />}
              </Link>
            );
          })}
        </div>
      )}
      <ul className="grid grid-cols-3 items-end gap-1">
        <li className="min-w-0"><NavLink item={primary[0]} pathname={pathname} /></li>
        <li className="flex min-w-0 justify-center">
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={t("nav_more")}
            className="relative z-40 -mt-6 grid h-14 w-14 place-items-center rounded-full bg-gradient-gold text-gold-foreground shadow-gold ring-4 ring-background"
          >
            {open ? <X className="h-6 w-6" /> : <LayoutGrid className="h-6 w-6" />}
            {hasOpenDispute && !open && <span className="absolute right-0.5 top-0.5 h-3 w-3 rounded-full border-2 border-background bg-destructive" />}
            {moreActive && !open && <span className="absolute -bottom-1 h-1 w-5 rounded-full bg-gold" />}
          </button>
        </li>
        <li className="min-w-0"><NavLink item={primary[1]} pathname={pathname} /></li>
      </ul>
    </nav>
  );
}

export function BottomNav({ variant = "buyer" }: { variant?: "buyer" | "seller" }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (variant === "seller") return <SellerBottomNav pathname={pathname} />;
  return (
    <nav aria-label="Main navigation" className="sticky bottom-0 z-30 mt-auto w-full border-t border-border/60 bg-surface/95 px-2 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl sm:px-4">
      <ul className="grid grid-flow-col auto-cols-fr gap-1">
        {buyerNavItems.map((item) => (
          <li key={item.to} className="min-w-0"><NavLink item={item} pathname={pathname} /></li>
        ))}
      </ul>
    </nav>
  );
}
