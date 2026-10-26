import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { useUnreadNotificationCount } from "@/hooks/queries/useNotifications";

/** The bell in the header, with a red count when something new is waiting. */
export function NotificationBell({ to }: { to: "/app/notifications" | "/seller/notifications" }) {
  const { data: unread = 0 } = useUnreadNotificationCount();
  return (
    <Link to={to} aria-label={unread ? `${unread} unread notifications` : "Notifications"}
      className="relative grid h-10 w-10 place-items-center rounded-full bg-surface transition-colors hover:bg-surface-2">
      <Bell className="h-5 w-5 text-gold" />
      {unread > 0 && (
        <span className="absolute -right-1 -top-1 grid min-w-[18px] place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-[18px] text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
