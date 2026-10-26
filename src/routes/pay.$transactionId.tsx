import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

/**
 * Landing page for the payment link we text to buyers (FRONTEND_URL/pay/<id>?sig=...).
 * Paying needs a signed-in buyer account, so: not signed in -> login (and come back),
 * signed in -> the pay screen. The API still checks that this account is the deal's buyer.
 */
export const Route = createFileRoute("/pay/$transactionId")({
  head: () => ({ meta: [{ title: "Pay securely — ZUNO" }, { name: "robots", content: "noindex" }] }),
  component: PayLink,
});

function PayLink() {
  const { transactionId } = Route.useParams();
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      navigate({ to: "/auth/login", search: { redirect: `/app/pay?tx=${encodeURIComponent(transactionId)}` } as never, replace: true });
    } else {
      navigate({ to: "/app/pay", search: { tx: transactionId } as never, replace: true });
    }
  }, [isLoading, user, transactionId, navigate]);

  return (
    <div className="grid min-h-screen place-items-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
