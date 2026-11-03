import { createFileRoute } from "@tanstack/react-router";
import { AdminUsers } from "@/components/zuno/AdminUsers";

export const Route = createFileRoute("/admin/sellers")({
  head: () => ({ meta: [{ title: "Sellers — ZUNO Admin" }] }),
  component: () => (
    <AdminGate>
      <AdminUsers role="seller" title="Sellers" />
    </AdminGate>
  ),
});
