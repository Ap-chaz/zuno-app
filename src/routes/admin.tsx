import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AdminGate } from "@/components/zuno/AdminGate";

/**
 * Root layout for all /admin routes.
 *
 * Enforces admin authorization via `<AdminGate>` across every child admin screen
 * (/admin, /admin/disputes, /admin/kyc, /admin/transactions, etc.) so individual
 * screens never have to repeat the gate or risk being left unprotected.
 */
export const Route = createFileRoute("/admin")({
  component: () => (
    <AdminGate>
      <Outlet />
    </AdminGate>
  ),
});
