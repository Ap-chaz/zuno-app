import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2, Send, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { TopBar } from "@/components/zuno/TopBar";
import { SellerPicker } from "@/components/zuno/SellerPicker";
import { useCreateContract, useFeeQuote } from "@/hooks/queries/useContracts";
import { DELIVERY_METHODS } from "@/services/contracts.service";
import { formatCurrency } from "@/services/transactions.service";

/**
 * Step 1 of a real deal: the BUYER writes down exactly what they expect and sends it to a seller.
 * The seller confirms in writing (or declines), then creates the payment request.
 */
export function NewDealRequest({ presetSellerId }: { presetSellerId?: string }) {
  const navigate = useNavigate();
  const create = useCreateContract();
  const [form, setForm] = useState({
    sellerId: presetSellerId ?? "",
    item: "",
    description: "",
    amount: "",
    expectations: "",
    delivery: "SELLER_ARRANGED",
    location: "",
  });
  const amount = Math.round(Number(form.amount) || 0);
  const { data: quote } = useFeeQuote(amount);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!form.sellerId) return toast.error("Choose the seller.");
    if (!form.item.trim()) return toast.error("Say what you are buying.");
    if (amount < 100) return toast.error("The minimum deal is Ksh 100.");
    if (form.expectations.trim().length < 20) {
      return toast.error("Describe what you expect in at least 20 characters (size, colour, condition, accessories…).");
    }
    try {
      await create.mutateAsync({
        sellerId: form.sellerId,
        itemName: form.item.trim(),
        itemDescription: form.description.trim() || undefined,
        amount,
        buyerExpectations: form.expectations.trim(),
        deliveryMethod: form.delivery,
        deliveryLocation: form.location.trim() || undefined,
      });
      toast.success("Request sent. The seller has 48 hours to confirm.");
      navigate({ to: "/app/track" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send your request.");
    }
  };

  const input = "h-12 w-full rounded-2xl border border-border/60 bg-input px-4 text-sm outline-none focus:border-gold/50";
  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <TopBar title="New Escrow Deal" back="/app" />
      <div className="space-y-3 px-5 pb-10 pt-4">
        <div className="flex items-center gap-2 rounded-2xl border border-accent/30 bg-accent/10 px-4 py-3">
          <ShieldCheck className="h-4 w-4 text-accent" />
          <p className="text-xs text-accent">You pay into escrow only after the seller agrees to your terms in writing.</p>
        </div>

        <label className="block text-xs font-semibold text-muted-foreground">Seller</label>
        <SellerPicker value={form.sellerId} onChange={(id) => setForm((f) => ({ ...f, sellerId: id }))} />

        <input className={input} placeholder="What are you buying? (e.g. Nike Air Max, size 42)" value={form.item} onChange={set("item")} />
        <input className={input} placeholder="Price agreed with the seller (KES)" inputMode="numeric" value={form.amount} onChange={set("amount")} />
        <textarea
          rows={4}
          className="w-full rounded-2xl border border-border/60 bg-input px-4 py-3 text-sm outline-none focus:border-gold/50"
          placeholder="Exactly what you expect: size, colour, condition, box, receipt, warranty…"
          value={form.expectations}
          onChange={set("expectations")}
        />
        <p className="-mt-1 px-1 text-[11px] text-muted-foreground">{form.expectations.trim().length}/20 characters minimum. This is what a dispute is judged against.</p>

        <select value={form.delivery} onChange={set("delivery")} className={input}>
          {/* Zuno courier is not live yet, so it is not offered. */}
          {DELIVERY_METHODS.filter((d) => d.id !== "PLATFORM_COURIER").map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
        <input className={input} placeholder="Delivery location (optional)" value={form.location} onChange={set("location")} />

        {quote && amount >= 100 && (
          <dl className="space-y-2 rounded-2xl border border-border/40 bg-surface p-4 text-sm">
            <Row k="Item price" v={formatCurrency(quote.itemPrice)} />
            <Row k="Escrow fee (your half)" v={formatCurrency(quote.buyerFeeShare)} />
            <div className="h-px bg-border/60" />
            <Row k="You will pay" v={formatCurrency(quote.buyerPays)} bold />
            <p className="text-[11px] text-muted-foreground">{quote.feePercent}% fee, shared equally with the seller. Final amount is confirmed before you pay.</p>
          </dl>
        )}

        <button
          onClick={submit}
          disabled={create.isPending}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-gold text-base font-semibold text-gold-foreground shadow-gold disabled:opacity-60"
        >
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send to seller
        </button>
      </div>
    </div>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className={bold ? "font-semibold" : "text-muted-foreground"}>{k}</dt>
      <dd className={bold ? "text-lg font-bold" : "font-medium"}>{v}</dd>
    </div>
  );
}
