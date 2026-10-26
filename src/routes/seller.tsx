import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/zuno/AppShell";
import { BottomNav } from "@/components/zuno/BottomNav";
import { Sidebar } from "@/components/zuno/Sidebar";
import { RequireAuth } from "@/components/zuno/RequireAuth";

export const Route = createFileRoute("/seller")({
  component: () => (
    <RequireAuth role="seller">
    <AppShell sidebar={<Sidebar variant="seller" />} bottomNav={<BottomNav variant="seller" />}>
      <Outlet />
    </AppShell>
    </RequireAuth>
  ),
});
