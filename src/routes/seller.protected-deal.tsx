import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  ShieldCheck,
  Copy,
  Check,
  ExternalLink,
  MessageCircle,
  Package,
  ArrowRight,
  Loader2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { TopBar } from "@/components/zuno/TopBar";
import { useAuth } from "@/hooks/useAuth";
import { useFeeQuote } from "@/hooks/queries/useContracts";
import { transactionsService, formatCurrency } from "@/services/transactions.service";
import { DELIVERY_METHODS } from "@/services/contracts.service";
import { categories } from "@/lib/zuno-data";
import type { Transaction } from "@/types/models";

export const Route = createFileRoute("/seller/protected-deal")({
  head: () => ({ meta: [{ title: "Create Protected Deal — ZUNO Seller" }] }),
  component: SellerProtectedDealPage,
});

function SellerProtectedDealPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    item: "",
    description: "",
    price: "",
    category: "Electronics",
    buyerName: "",
    buyerPhone: "",
    deliveryMethod: "SELLER_ARRANGED",
  });

  const [createdDeal, setCreatedDeal] = useState<Transaction | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  const numericPrice = Math.round(Number(form.price) || 0);
  const { data: quote } = useFeeQuote(numericPrice);

  const handleChange =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setForm((prev) => ({ ...prev, [k]: e.target.value }));
    };

  const handleCreate = async () => {
    if (!form.item.trim()) return toast.error("Enter the item name.");
    if (numericPrice < 100) return toast.error("Minimum deal amount is KES 100.");
    if (!form.buyerName.trim()) return toast.error("Enter the buyer's name or username.");

    setLoading(true);
    try {
      const fee = quote?.platformFee ?? Math.round(numericPrice * 0.025);
      const buyerFee = quote?.buyerFeeShare ?? Math.ceil(fee / 2);
      const sellerFee = quote?.sellerFeeShare ?? fee - buyerFee;

      const newTx = await transactionsService.create({
        item: form.item.trim(),
        seller: user?.name || "Merchant",
        sellerId: user?.id || "seller-account",
        buyerName: form.buyerName.trim(),
        amount: numericPrice,
        category: form.category,
        deliveryMethod: form.deliveryMethod,
        buyerPays: numericPrice + buyerFee,
        sellerReceives: numericPrice - sellerFee,
        platformFee: fee,
        buyerFeeShare: buyerFee,
        sellerFeeShare: sellerFee,
      });

      setCreatedDeal(newTx);
      toast.success("SafePay Deal created! Share the link with your buyer.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create deal.");
    } finally {
      setLoading(false);
    }
  };

  const payUrl =
    typeof window !== "undefined" && createdDeal
      ? `${window.location.origin}/pay/${createdDeal.id}`
      : "";

  const handleCopyLink = () => {
    if (!payUrl) return;
    navigator.clipboard.writeText(payUrl);
    setCopied(true);
    toast.success("SafePay payment link copied to clipboard!");
    setTimeout(() => setCopied(false), 2500);
  };

  const shareText = createdDeal
    ? encodeURIComponent(
        `Hi ${form.buyerName || "there"}, here is our ZUNO SafePay Escrow link for "${createdDeal.item}" (${formatCurrency(createdDeal.amount)}):\n\n${payUrl}\n\nYour payment is held safely in escrow until you inspect and confirm delivery.`,
      )
    : "";

  const waUrl = form.buyerPhone
    ? `https://api.whatsapp.com/send?phone=${form.buyerPhone.replace(/[^0-9]/g, "")}&text=${shareText}`
    : `https://api.whatsapp.com/send?text=${shareText}`;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <TopBar title="Protected Deal Generator" back="/seller/safepay" />

      <div className="px-4 sm:px-6 pt-4 pb-12 max-w-xl mx-auto w-full">
        {!createdDeal ? (
          <div>
            {/* Header Card */}
            <div className="rounded-3xl border border-border/40 bg-gradient-card p-5 shadow-card">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gold/15 text-gold">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-base font-bold text-foreground">
                    Create a SafePay Payment Link
                  </h1>
                  <p className="text-xs text-muted-foreground">
                    Send an escrow payment link directly to your customer on WhatsApp or Instagram.
                  </p>
                </div>
              </div>
            </div>

            {/* Form Fields */}
            <div className="mt-5 space-y-3.5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Item or Service
                </label>
                <input
                  value={form.item}
                  onChange={handleChange("item")}
                  placeholder="e.g. iPhone 15 Pro Max, 256GB Natural"
                  className="h-12 w-full rounded-2xl border border-border/60 bg-input px-4 text-sm outline-none focus:border-gold/50"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Item Description / Condition
                </label>
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={handleChange("description")}
                  placeholder="Brand new sealed in box with 1-year warranty and receipt"
                  className="w-full rounded-2xl border border-border/60 bg-input p-3 text-sm outline-none focus:border-gold/50"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                    Agreed Price (KES)
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={form.price}
                    onChange={handleChange("price")}
                    placeholder="e.g. 85000"
                    className="h-12 w-full rounded-2xl border border-border/60 bg-input px-4 text-sm outline-none focus:border-gold/50"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                    Category
                  </label>
                  <select
                    value={form.category}
                    onChange={handleChange("category")}
                    className="h-12 w-full rounded-2xl border border-border/60 bg-input px-4 text-sm outline-none focus:border-gold/50"
                  >
                    {categories
                      .filter((c) => c !== "All")
                      .map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              {/* Live Fee Breakdown */}
              {numericPrice > 0 && (
                <div className="rounded-2xl border border-border/60 bg-surface-2/60 p-3.5 text-xs space-y-1.5">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Buyer pays (Item + 50% fee share):</span>
                    <span className="font-semibold text-foreground">
                      {formatCurrency(quote?.buyerPays ?? numericPrice + Math.ceil(numericPrice * 0.0125))}
                    </span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Your payout on delivery (Net after fee):</span>
                    <span className="font-semibold text-success">
                      {formatCurrency(quote?.sellerReceives ?? numericPrice - Math.floor(numericPrice * 0.0125))}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/40">
                    SafePay fee is split 50/50 between you and the customer. Escrow protection is guaranteed.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                    Buyer Name
                  </label>
                  <input
                    value={form.buyerName}
                    onChange={handleChange("buyerName")}
                    placeholder="e.g. Peter Njoroge"
                    className="h-12 w-full rounded-2xl border border-border/60 bg-input px-4 text-sm outline-none focus:border-gold/50"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                    Buyer WhatsApp / Phone
                  </label>
                  <input
                    value={form.buyerPhone}
                    onChange={handleChange("buyerPhone")}
                    placeholder="+2547XXXXXXXX"
                    className="h-12 w-full rounded-2xl border border-border/60 bg-input px-4 text-sm outline-none focus:border-gold/50"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Fulfillment & Delivery
                </label>
                <select
                  value={form.deliveryMethod}
                  onChange={handleChange("deliveryMethod")}
                  className="h-12 w-full rounded-2xl border border-border/60 bg-input px-4 text-sm outline-none focus:border-gold/50"
                >
                  {DELIVERY_METHODS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                disabled={loading || numericPrice < 100 || !form.item.trim()}
                onClick={handleCreate}
                className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-gold text-base font-semibold text-gold-foreground shadow-gold transition-opacity disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Sparkles className="h-5 w-5" />
                )}
                Generate Escrow Payment Link
              </button>
            </div>
          </div>
        ) : (
          /* Deal Created / Share Link Screen */
          <div className="space-y-4">
            <div className="rounded-3xl border border-success/30 bg-success/10 p-6 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-success text-white">
                <Check className="h-6 w-6 stroke-[3]" />
              </div>
              <h1 className="mt-3 text-lg font-bold text-foreground">SafePay Deal Ready!</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                Deal reference: <span className="font-mono font-bold text-foreground">#{createdDeal.id}</span>
              </p>
            </div>

            {/* Deal Summary Box */}
            <div className="rounded-2xl border border-border/60 bg-surface p-4 text-sm space-y-2">
              <div className="flex justify-between items-center pb-2 border-b border-border/40">
                <span className="font-semibold text-foreground">{createdDeal.item}</span>
                <span className="font-bold text-foreground">{formatCurrency(createdDeal.amount)}</span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Customer:</span>
                <span className="text-foreground">{createdDeal.buyerName}</span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Buyer total to pay:</span>
                <span className="font-semibold text-foreground">
                  {formatCurrency(createdDeal.buyerPays ?? createdDeal.amount)}
                </span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>You receive on approval:</span>
                <span className="font-semibold text-success">
                  {formatCurrency(createdDeal.sellerReceives ?? createdDeal.amount)}
                </span>
              </div>
            </div>

            {/* Copyable Link Box */}
            <div className="rounded-2xl border border-border/60 bg-surface p-3.5 space-y-2">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Payment Link
              </p>
              <div className="flex items-center gap-2 rounded-xl bg-surface-2 p-2">
                <input
                  readOnly
                  value={payUrl}
                  className="min-w-0 flex-1 bg-transparent px-2 font-mono text-xs text-foreground outline-none"
                />
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="flex h-9 items-center gap-1.5 rounded-lg bg-surface border border-border/60 px-3 text-xs font-semibold text-foreground transition-colors hover:bg-surface-2"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-success" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Share via WhatsApp Button */}
            <a
              href={waUrl}
              target="_blank"
              rel="noreferrer"
              className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#25D366] text-base font-semibold text-white shadow-md transition-opacity hover:opacity-95"
            >
              <MessageCircle className="h-5 w-5 fill-white" /> Share with Customer via WhatsApp
            </a>

            {/* Additional Actions */}
            <div className="pt-2 flex gap-2">
              <Link
                to="/seller/deliveries"
                className="flex-1 flex h-12 items-center justify-center gap-1.5 rounded-xl border border-border/60 bg-surface text-xs font-semibold text-foreground hover:bg-surface-2 transition-colors"
              >
                <Package className="h-4 w-4" /> Go to Deliveries
              </Link>
              <button
                type="button"
                onClick={() => {
                  setCreatedDeal(null);
                  setForm({
                    item: "",
                    description: "",
                    price: "",
                    category: "Electronics",
                    buyerName: "",
                    buyerPhone: "",
                    deliveryMethod: "SELLER_ARRANGED",
                  });
                }}
                className="flex-1 flex h-12 items-center justify-center gap-1.5 rounded-xl border border-border/60 bg-surface text-xs font-semibold text-foreground hover:bg-surface-2 transition-colors"
              >
                Create Another Deal
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
