import { createFileRoute } from "@tanstack/react-router";
import { AdminUsers } from "@/components/zuno/AdminUsers";

export const Route = createFileRoute("/admin/seller-accounts")({
  head: () => ({ meta: [{ title: "Seller Accounts — ZUNO Admin" }] }),
  component: () => (
    <AdminGate>
      <AdminUsers role="seller" title="Seller Accounts" />
    </AdminGate>
  ),
});
