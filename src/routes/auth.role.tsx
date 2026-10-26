import { createFileRoute, redirect } from "@tanstack/react-router";

// The buyer/seller choice now happens on the sign-up form and is stored on the server.
export const Route = createFileRoute("/auth/role")({
  beforeLoad: () => {
    throw redirect({ to: "/auth/signup" });
  },
});
