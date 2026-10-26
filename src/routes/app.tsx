import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/zuno/AppShell";
import { BottomNav } from "@/components/zuno/BottomNav";
import { Sidebar } from "@/components/zuno/Sidebar";
import { RequireAuth } from "@/components/zuno/RequireAuth";

export const Route = createFileRoute("/app")({
  component: () => (
    <RequireAuth role="buyer">
    <AppShell sidebar={<Sidebar variant="buyer" />} bottomNav={<BottomNav variant="buyer" />}>
      <Outlet />
    </AppShell>
    </RequireAuth>
  ),
});
