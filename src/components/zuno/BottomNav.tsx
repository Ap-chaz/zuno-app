import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Store, LayoutDashboard, Truck, Wallet, Inbox } from "lucide-react";
import type { ComponentType } from "react";
import { useLanguage } from "@/hooks/useLanguage";
import type { TranslationKey } from "@/lib/i18n/translations";

export type NavItem = { to: string; labelKey: TranslationKey; icon: ComponentType<{ className?: string }>; matchPrefix?: string };

export const buyerNavItems: NavItem[] = [
  { to: "/app", labelKey: "nav_home", icon: Home },
  { to: "/app/sellers", labelKey: "nav_sellers", icon: Store },
  { to: "/app/track", labelKey: "nav_tracking", icon: Truck, matchPrefix: "/app/track" },
];

export const sellerNavItems: NavItem[] = [
  { to: "/seller", labelKey: "nav_overview", icon: LayoutDashboard },
  { to: "/seller/contracts", labelKey: "nav_requests", icon: Inbox },
  { to: "/seller/deliveries", labelKey: "nav_orders", icon: Truck },
  { to: "/seller/transactions", labelKey: "nav_payouts", icon: Wallet },
];

// Back-compat aliases used within this file.
const buyerItems = buyerNavItems;
const sellerItems = sellerNavItems;

export function BottomNav({ variant = "buyer" }: { variant?: "buyer" | "seller" }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { t } = useLanguage();
  const items = variant === "seller" ? sellerItems : buyerItems;

  return (
    <nav aria-label={variant === "seller" ? "Seller navigation" : "Main navigation"} className="sticky bottom-0 z-30 mt-auto w-full border-t border-border/60 bg-surface/95 px-2 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl sm:px-4">
      <ul className="grid grid-flow-col auto-cols-fr gap-1">
        {items.map(({ to, labelKey, icon: Icon, matchPrefix }) => {
          const prefix = matchPrefix || to;
          const active = pathname === to || (to !== "/app" && to !== "/seller" && pathname.startsWith(prefix));
          const exactRoot = (to === "/app" || to === "/seller") && pathname === to;
          const isActive = active || exactRoot;
          return (
            <li key={to} className="min-w-0">
              <Link
                to={to}
                aria-current={isActive ? "page" : undefined}
                className={`flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium transition-colors ${
                  isActive ? "text-gold" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className={`grid h-9 w-9 place-items-center rounded-xl transition-all ${isActive ? "bg-gold/15" : ""}`}>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="max-w-full truncate">{t(labelKey)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
