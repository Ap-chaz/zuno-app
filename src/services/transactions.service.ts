import { apiClient, ApiError } from "@/lib/api/client";
import { mockResolve, mockReject } from "@/lib/api/mock-adapter";
import { env } from "@/config/env";
import { transactions as seedTransactions, sellers as seedSellers } from "@/lib/zuno-data";
import { mapTransaction } from "@/lib/api/mappers";
import type { Transaction, TxStatus } from "@/types/models";

// `zuno-data.ts` remains the single source of seed data (still consumed
// directly by routes not yet migrated to the service layer). We adapt it
// here to the richer `Transaction` shape rather than keeping a second copy,
// so the two can't drift out of sync.
const MOCK_TRANSACTIONS: Transaction[] = seedTransactions.map((t) => ({
  ...t,
  currency: "KES",
  sellerId: seedSellers.find((s) => s.name === t.seller)?.id ?? t.seller.toLowerCase().replace(/\s+/g, "-"),
}));

export const ACTIVE_STATUSES: TxStatus[] = ["Pending", "Funded", "Protected", "In transit", "Inspection", "Disputed"];

export function formatCurrency(amount: number, currency: Transaction["currency"] = "KES"): string {
  return `${currency} ${amount.toLocaleString()}`;
}

export function statusColorClass(s: TxStatus): string {
  switch (s) {
    case "Completed":
      return "bg-success/15 text-success border-success/30";
    case "Funded":
    case "Protected":
    case "In transit":
    case "Inspection":
      return "bg-accent/20 text-accent border-accent/30";
    case "Pending":
      return "bg-gold/15 text-gold border-gold/30";
    case "Refunded":
    case "Resolved":
    case "Cancelled":
      return "bg-muted text-muted-foreground border-border";
    case "Disputed":
      return "bg-destructive/15 text-destructive border-destructive/30";
  }
}

/** Real mode only: the status flow is driven by dedicated API actions, never by writing a status. */
function unsupported(what: string): never {
  throw new ApiError(`${what} is not available in this version.`, 400, "NOT_SUPPORTED");
}

export interface PaymentStatus {
  status: TxStatus;
  funded: boolean;
  mpesaReference?: string;
  /** Why the latest M-Pesa attempt failed (set by the API when Safaricom reports a failure). */
  lastFailure?: string;
}

export interface FeeQuote {
  itemPrice: number;
  platformFee: number;
  buyerFeeShare: number;
  sellerFeeShare: number;
  buyerPays: number;
  sellerReceives: number;
  feePercent: number;
}

export const transactionsService = {
  /** Exact fees as the API will charge them. The UI never calculates fees for a real deal. */
  async quote(amount: number): Promise<FeeQuote> {
    if (env.useMockApi) {
      const fee = Math.round(amount * 0.025);
      const buyerFeeShare = Math.ceil(fee / 2);
      return mockResolve({ itemPrice: amount, platformFee: fee, buyerFeeShare, sellerFeeShare: fee - buyerFeeShare,
        buyerPays: amount + buyerFeeShare, sellerReceives: amount - (fee - buyerFeeShare), feePercent: 2.5 }, 150);
    }
    const q = await apiClient.get<Record<string, number>>(`/transactions/quote?amount=${Math.round(amount)}`);
    return { itemPrice: q.item_price, platformFee: q.platform_fee, buyerFeeShare: q.buyer_fee_share,
      sellerFeeShare: q.seller_fee_share, buyerPays: q.buyer_pays, sellerReceives: q.seller_receives, feePercent: q.fee_percent };
  },

  async list(): Promise<Transaction[]> {
    if (env.useMockApi) return mockResolve([...MOCK_TRANSACTIONS]);
    const rows = await apiClient.getList<Record<string, unknown>>("/transactions/my", "transactions");
    return rows.map(mapTransaction);
  },

  /** Fee preview comes from the server's own numbers; the UI never calculates fees for a real deal. */
  async getById(id: string): Promise<Transaction> {
    if (env.useMockApi) {
      const found = MOCK_TRANSACTIONS.find((t) => t.id === id);
      if (!found) return mockReject(`Transaction ${id} not found`, 404, "NOT_FOUND");
      return mockResolve(found);
    }
    const res = await apiClient.get<{ transaction: Record<string, unknown> }>(`/transactions/${id}`);
    return mapTransaction(res.transaction);
  },

  async listActive(): Promise<Transaction[]> {
    const all = await this.list();
    return all.filter((t) => ACTIVE_STATUSES.includes(t.status));
  },

  async create(input: Omit<Transaction, "id" | "date" | "status" | "currency"> & { currency?: "KES" }): Promise<Transaction> {
    if (env.useMockApi) {
      const created: Transaction = {
        ...input,
        currency: "KES",
        id: `ZUNO${Math.random().toString(36).slice(2, 12).toUpperCase()}`,
        date: new Date().toISOString().slice(0, 10),
        status: "Pending",
      };
      MOCK_TRANSACTIONS.unshift(created);
      return mockResolve(created);
    }
    return unsupported("Creating a deal directly");
  },

  async updateStatus(id: string, status: TxStatus): Promise<Transaction> {
    if (env.useMockApi) {
      const found = MOCK_TRANSACTIONS.find((t) => t.id === id);
      if (!found) return mockReject(`Transaction ${id} not found`, 404, "NOT_FOUND");
      found.status = status;
      return mockResolve(found);
    }
    return unsupported(`Setting a deal to ${status}`);
  },

  /** Admin-only: mark/unmark a transaction for manual fraud review. */
  async toggleFlag(id: string, flagged: boolean): Promise<Transaction> {
    if (env.useMockApi) {
      const found = MOCK_TRANSACTIONS.find((t) => t.id === id);
      if (!found) return mockReject(`Transaction ${id} not found`, 404, "NOT_FOUND");
      found.flaggedForReview = flagged;
      return mockResolve(found);
    }
    return unsupported("Flagging");
  },

  /**
   * Admin-only: record that the actual money (seller payout or buyer refund)
   * has been sent. This does NOT move any real money itself — it's a manual
   * checkbox until a real payment integration exists.
   */
  async markPayoutPaid(id: string): Promise<Transaction> {
    if (env.useMockApi) {
      const found = MOCK_TRANSACTIONS.find((t) => t.id === id);
      if (!found) return mockReject(`Transaction ${id} not found`, 404, "NOT_FOUND");
      found.payoutStatus = "paid";
      return mockResolve(found);
    }
    return unsupported("Marking a payout as paid (payouts are sent automatically)");
  },

  // ── Real lifecycle actions (each is validated and authorised by the API) ──

  /** Seller: hand the item over for delivery. */
  async ship(id: string, input: { trackingNumber: string; courierName?: string; notes?: string }): Promise<void> {
    if (env.useMockApi) {
      const found = MOCK_TRANSACTIONS.find((t) => t.id === id);
      if (found) found.status = "In transit";
      return mockResolve<void>(undefined);
    }
    await apiClient.post(`/transactions/${id}/ship`, {
      tracking_number: input.trackingNumber,
      courier_name: input.courierName,
      shipping_notes: input.notes,
    });
  },

  /** Buyer: "I received it" — starts the inspection window. */
  async confirmDelivery(id: string): Promise<void> {
    if (env.useMockApi) {
      const found = MOCK_TRANSACTIONS.find((t) => t.id === id);
      if (found) found.status = "Inspection";
      return mockResolve<void>(undefined);
    }
    await apiClient.post(`/transactions/${id}/confirm-delivery`);
  },

  /** Buyer: approve during inspection. Releases the funds to the seller. */
  async approve(id: string, rating?: { score: number; comment?: string }): Promise<void> {
    if (env.useMockApi) {
      const found = MOCK_TRANSACTIONS.find((t) => t.id === id);
      if (found) found.status = "Completed";
      return mockResolve<void>(undefined);
    }
    await apiClient.post(`/transactions/${id}/approve`, rating ? { rating: rating.score, comment: rating.comment } : {});
  },

  async cancel(id: string, reason?: string): Promise<void> {
    if (env.useMockApi) {
      const found = MOCK_TRANSACTIONS.find((t) => t.id === id);
      if (found) found.status = "Cancelled";
      return mockResolve<void>(undefined);
    }
    await apiClient.post(`/transactions/${id}/cancel`, { reason });
  },

  /** Buyer: ask M-Pesa to send the PIN prompt to this phone. The amount comes from the server. */
  async pay(id: string, mpesaPhone: string): Promise<void> {
    if (env.useMockApi) {
      const found = MOCK_TRANSACTIONS.find((t) => t.id === id);
      if (found) found.status = "Funded";
      return mockResolve<void>(undefined, 1200);
    }
    await apiClient.post("/payments/initiate", { transaction_id: id, mpesa_phone: mpesaPhone });
  },

  async paymentStatus(id: string): Promise<PaymentStatus> {
    if (env.useMockApi) {
      const found = MOCK_TRANSACTIONS.find((t) => t.id === id);
      return mockResolve({ status: found?.status ?? "Pending", funded: found?.status === "Funded" });
    }
    const r = await apiClient.get<Record<string, any>>(`/payments/status/${id}`); // eslint-disable-line @typescript-eslint/no-explicit-any
    const t = mapTransaction({ id, status: r.status, payment_reference: r.payment_reference ?? r.mpesa_reference });
    return { status: t.status, funded: Boolean(r.is_paid), mpesaReference: t.mpesaReference, lastFailure: r.last_failure ?? undefined };
  },
};
