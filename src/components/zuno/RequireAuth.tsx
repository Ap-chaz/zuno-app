import { useEffect, type ReactNode } from "react";
import { useNavigate, useLocation } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { homeFor } from "@/lib/zuno-role";

/**
 * Keeps logged-out people (and people with the wrong role) out of a section of the app.
 * This is a convenience for the UI. The API independently enforces every one of these rules.
 *
 *   <RequireAuth role="seller">…</RequireAuth>
 * `role` omitted = any signed-in user.
 */
export function RequireAuth({ role, children }: { role?: "buyer" | "seller" | "admin"; children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const wrongRole = Boolean(user && role && user.role !== role && user.role !== "admin");

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      navigate({ to: "/auth/login", search: { redirect: location.pathname } as never, replace: true });
    } else if (!user.phoneVerified) {
      navigate({ to: "/auth/verify", replace: true });
    } else if (wrongRole) {
      navigate({ to: homeFor(user.role) as never, replace: true });
    }
  }, [isLoading, user, wrongRole, navigate, location.pathname]);

  if (isLoading || !user || !user.phoneVerified || wrongRole) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return <>{children}</>;
}
