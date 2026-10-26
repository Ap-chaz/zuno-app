import { createFileRoute } from "@tanstack/react-router";
import { DisputeThread } from "@/components/zuno/DisputeThread";

export const Route = createFileRoute("/app/dispute/$id")({
  head: () => ({ meta: [{ title: "Dispute — ZUNO" }] }),
  component: () => <DisputeThread id={Route.useParams().id} backTo="/app/disputes" />,
});
