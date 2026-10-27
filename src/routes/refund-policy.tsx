import { createFileRoute, Link } from "@tanstack/react-router";

const LAST_UPDATED = "August 26, 2026";

export const Route = createFileRoute("/refund-policy")({
  head: () => ({
    meta: [
      { title: "Refund policy — ZUNO Escrow" },
      { name: "description", content: "When and how ZUNO refunds a buyer's escrow payment." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <section className="pt-32 pb-24 lg:pt-40">
      <div className="mx-auto max-w-[720px] px-6 lg:px-8">
        <p className="eyebrow">Legal</p>
        <h1 className="text-display-lg mt-3">Refund policy</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>
        <div className="mt-10 max-w-none text-muted-foreground [&>h2]:mt-8 [&>h2]:mb-3 [&>h2]:text-foreground [&>h2]:font-display [&>h2]:text-xl [&>p]:leading-relaxed [&>p]:mb-5">
          <h2>1. How refunds work on ZUNO</h2>
          <p>A refund is the return of a buyer's escrow payment before it is released to the seller. Because ZUNO holds funds rather than the item itself, a refund is only possible while the transaction is still in an unreleased state — Pending, Funded, Protected, or Disputed.</p>
          <h2>2. When a buyer is refunded in full</h2>
          <ul className="list-disc space-y-2 pl-6">
            <li>The seller fails to deliver within the agreed timeline and cannot show proof of shipment.</li>
            <li>The item received is materially different from what was described, and the seller cannot resolve it.</li>
            <li>The seller cancels the deal before delivery.</li>
            <li>A dispute is reviewed and ruled in the buyer's favor under our <Link to="/dispute-policy" className="text-foreground underline underline-offset-2">Dispute policy</Link>.</li>
          </ul>
          <h2>3. Platform fees</h2>
          <p>The ZUNO platform fee is non-refundable once a transaction is released to the seller. Where a dispute is resolved in the buyer's favor, the fee tied to that transaction is refunded along with the escrow amount.</p>
          <h2>4. How a refund is paid out</h2>
          <p>Refunds are returned to the same payment method used to fund the escrow — M-Pesa. Processing typically completes within 1–5 business days.</p>
          <h2>5. Partial refunds</h2>
          <p>Where a buyer keeps part of an order and returns the rest, or where a seller and buyer agree to a partial resolution, ZUNO can release a partial amount to each party as agreed in writing during a dispute or directly between the two parties.</p>
          <h2>6. What isn't covered</h2>
          <p>Once escrow funds are released to a seller following buyer confirmation, ZUNO cannot reverse that payout. Buyers should confirm delivery only once they're satisfied the item or service matches what was agreed.</p>
          <h2>7. How to request a refund</h2>
          <p>If a delivery hasn't happened or something's wrong with an order, open a dispute from the transaction in your Activity tab, or contact Help &amp; Support in your account settings.</p>
        </div>
      </div>
    </section>
  ),
});
