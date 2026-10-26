import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CreditCard, Truck, Shield, BadgeCheck, AlertTriangle, Gift, Bell, CheckCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { TopBar } from "@/components/zuno/TopBar";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/StateViews";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "@/hooks/queries/useNotifications";
import type { Notification } from "@/types/models";

export const Route = createFileRoute("/app/notifications")({
  head: () => ({ meta: [{ title: "Notifications — ZUNO" }] }),
  component: () => <NotificationsPage backTo="/app" />,
});

const ICONS: Record<Notification["type"], { icon: LucideIcon; className: string }> = {
  transaction: { icon: CreditCard, className: "text-success bg-success/15" },
  dispute: { icon: AlertTriangle, className: "text-destructive bg-destructive/15" },
  kyc: { icon: BadgeCheck, className: "text-gold bg-gold/15" },
  system: { icon: Gift, className: "text-accent bg-accent/15" },
};

function groupByRecency(items: Notification[]) {
  const now = Date.now();
  const today: Notification[] = [];
  const thisWeek: Notification[] = [];
  const older: Notification[] = [];
  for (const n of items) {
    const ageMs = now - new Date(n.createdAt).getTime();
    if (ageMs < 1000 * 60 * 60 * 24) today.push(n);
    else if (ageMs < 1000 * 60 * 60 * 24 * 7) thisWeek.push(n);
    else older.push(n);
  }
  return [
    { title: "Today", items: today },
    { title: "This week", items: thisWeek },
    { title: "Earlier", items: older },
  ].filter((g) => g.items.length > 0);
}

export function NotificationsPage({ backTo = "/app" }: { backTo?: string }) {
  const { data: notifications, isLoading, isError, refetch } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const navigate = useNavigate();
  const isSeller = backTo.startsWith("/seller");

  // Where a notification should take you. Disputes carry the dispute id, deals carry the deal number.
  function open(n: Notification) {
    if (!n.read) markRead.mutate(n.id);
    let to: string | null = null;
    if (n.type === "dispute" && n.relatedId) to = `${isSeller ? "/seller" : "/app"}/dispute/${n.relatedId}`;
    else if (n.type === "transaction") {
      // related ids look like "contract:12", "payout:ZNO-..." or a plain deal number
      const [kind, id] = n.relatedId?.includes(":") ? (n.relatedId.split(":") as [string, string]) : ["deal", n.relatedId ?? ""];
      const isContractNote = /^(New deal request|Seller (accepted|declined) your deal)/.test(n.title);   // older ones have no id saved
      if (kind === "contract" || isContractNote) to = isSeller ? "/seller/contracts" : "/app/track";
      else if (kind === "payout") to = isSeller ? "/seller/transactions" : "/app/transactions";
      else to = isSeller ? "/seller/deliveries" : id ? `/app/tracking/${id}` : "/app/track";
    }
    else if (n.type === "kyc") to = isSeller ? "/seller/verification" : null;
    if (to) navigate({ to: to as never });
  }
  const hasUnread = (notifications ?? []).some((n) => !n.read);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <TopBar
        title="Notifications"
        back={backTo}
        right={
          hasUnread ? (
            <button
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              aria-label="Mark all notifications as read"
              className="grid h-10 w-10 place-items-center rounded-xl bg-surface text-gold transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              <CheckCheck className="h-5 w-5" />
            </button>
          ) : undefined
        }
      />

      <div className="px-4 sm:px-6 pt-4 pb-8">
        {isLoading && <ListSkeleton rows={4} />}

        {isError && <ErrorState description="Couldn't load your notifications." onRetry={() => refetch()} />}

        {!isLoading && !isError && (notifications?.length ?? 0) === 0 && (
          <EmptyState icon={Bell} title="You're all caught up" description="New activity on your deals will show up here." />
        )}

        {!isLoading &&
          !isError &&
          groupByRecency(notifications ?? []).map((g) => (
            <div key={g.title} className="mt-4 first:mt-0">
              <p className="px-1 text-xs font-bold tracking-[0.18em] text-muted-foreground">{g.title.toUpperCase()}</p>
              <ul className="mt-2 space-y-2">
                {g.items.map((n) => {
                  const { icon: Icon, className } = ICONS[n.type];
                  return (
                    <li key={n.id}>
                      <button
                        onClick={() => open(n)}
                        className={`grid w-full grid-cols-[auto_1fr_auto] items-start gap-3 rounded-2xl border p-4 text-left transition-colors ${
                          n.read ? "border-border/40 bg-surface" : "border-gold/30 bg-gold/5"
                        }`}
                      >
                        <span className={`grid h-10 w-10 place-items-center rounded-2xl ${className}`}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{n.title}</p>
                          <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                        </div>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {new Date(n.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
      </div>
    </div>
  );
}
