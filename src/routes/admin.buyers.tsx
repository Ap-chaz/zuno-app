import { createFileRoute } from "@tanstack/react-router";
import { AdminUsers } from "@/components/zuno/AdminUsers";

export const Route = createFileRoute("/admin/buyers")({
  head: () => ({ meta: [{ title: "Buyer Accounts — ZUNO Admin" }] }),
  component: () => (
    <AdminGate>
      <AdminUsers role="buyer" title="Buyer Accounts" />
    </AdminGate>
  ),
});
