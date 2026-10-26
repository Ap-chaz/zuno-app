import { Link, useRouterState } from "@tanstack/react-router";
import { HelpCircle, Settings } from "lucide-react";
import { buyerNavItems, sellerNavItems } from "@/components/zuno/BottomNav";
import { Logo } from "@/components/zuno/Logo";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { getAvatarInitial, getFirstName } from "@/lib/user-display";

const linkBase =
  "flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors";
const linkActive = "bg-gold/15 text-gold";
const linkIdle = "text-muted-foreground hover:bg-surface hover:text-foreground";

/**
 * Persistent left navigation (lg+). Fixed 240px width (set by AppShell).
 *
 * Layout: flex column, `justify-between`.
 *  - top:    logo + primary navigation, tightly grouped
 *  - bottom: secondary links (Settings, Help) + profile, anchored to the base
 */
export function Sidebar({ variant = "buyer" }: { variant?: "buyer" | "seller" }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { t } = useLanguage();
  const { user } = useAuth();
  const items = variant === "seller" ? sellerNavItems : buyerNavItems;
  const root = variant === "seller" ? "/seller" : "/app";

  const secondary = [
    { to: `${root}/settings`, label: t("nav_settings"), icon: Settings },
    { to: variant === "seller" ? "/seller/help" : "/help", label: t("nav_help"), icon: HelpCircle },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col justify-between gap-6 overflow-y-auto px-3 py-6">
      <div className="min-w-0">
        <div className="flex items-center gap-2 px-3">
          <Logo />
          {variant === "seller" && (
            <span className="rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] font-bold text-gold">SELLER</span>
          )}
        </div>

        <nav aria-label={variant === "seller" ? "Seller navigation" : "Main navigation"} className="mt-8 flex flex-col gap-1">
          {items.map(({ to, labelKey, icon: Icon, matchPrefix }) => {
            const prefix = matchPrefix || to;
            const isActive = pathname === to || (to !== root && pathname.startsWith(prefix));
            return (
              <Link
                key={to}
                to={to}
                aria-current={isActive ? "page" : undefined}
                className={`${linkBase} ${isActive ? linkActive : linkIdle}`}
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="truncate">{t(labelKey)}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="min-w-0">
        <nav aria-label="Secondary navigation" className="flex flex-col gap-1 border-t border-border/40 pt-4">
          {secondary.map(({ to, label, icon: Icon }) => {
            const isActive = pathname === to || pathname.startsWith(`${to}/`);
            return (
              <Link
                key={to}
                to={to}
                aria-current={isActive ? "page" : undefined}
                className={`${linkBase} ${isActive ? linkActive : linkIdle}`}
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="truncate">{label}</span>
              </Link>
            );
          })}
        </nav>

        <Link
          to={`${root}/account`}
          aria-label={t("nav_account")}
          className="mt-3 flex min-w-0 items-center gap-3 rounded-xl border border-border/40 bg-surface px-3 py-2.5 transition-colors hover:bg-surface-2"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-gold text-sm font-bold text-gold-foreground">
            {getAvatarInitial(user)}
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm font-semibold">{getFirstName(user)}</span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {variant === "seller" ? "Seller dashboard" : "Buyer dashboard"}
            </span>
          </span>
        </Link>
      </div>
    </div>
  );
}
