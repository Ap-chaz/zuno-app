import { createFileRoute } from "@tanstack/react-router";
import { DisputeThread } from "@/components/zuno/DisputeThread";

export const Route = createFileRoute("/seller/dispute/$id")({
  head: () => ({ meta: [{ title: "Dispute — ZUNO Seller" }] }),
  component: () => <DisputeThread id={Route.useParams().id} backTo="/seller/disputes" />,
});
