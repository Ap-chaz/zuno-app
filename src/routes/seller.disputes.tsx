import { createFileRoute } from "@tanstack/react-router";
import { Disputes } from "./app.disputes";

export const Route = createFileRoute("/seller/disputes")({
  head: () => ({ meta: [{ title: "Dispute Center — ZUNO Seller" }] }),
  component: SellerDisputes,
});

const SELLER_REASONS = [
  { title: "Buyer disputes a delivered item", desc: "You have proof of delivery, but the buyer claims otherwise" },
  { title: "Unfair return or refund request", desc: "A buyer is requesting a refund you don't believe is valid" },
  { title: "Other issue", desc: "Tell us what happened" },
];

function SellerDisputes() {
  return (
    <Disputes
      backTo="/seller"
      helpTo="/seller/help"
      threadBase="/seller/dispute"
      emptyOrdersLabel="No open orders to report"
      reasons={SELLER_REASONS}
    />
  );
}
