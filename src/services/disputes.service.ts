import { apiClient } from "@/lib/api/client";
import { mockReject } from "@/lib/api/mock-adapter";
import { mockResolve } from "@/lib/api/mock-adapter";
import { env } from "@/config/env";
import { mapDispute, toIso } from "@/lib/api/mappers";
import type { Dispute } from "@/types/models";

const MOCK_DISPUTES: Dispute[] = [
  {
    id: "d1",
    transactionId: "ZUNO9DF8GH7JK6",
    reason: "Item not as described",
    description: "The drone arrived with a different battery than advertised.",
    status: "under_review",
    createdAt: "2026-05-20T09:00:00.000Z",
    evidenceUrls: [],
  },
];

/** UI reason titles → API categories. */
const REASON_TO_CATEGORY: Record<string, string> = {
  "item not received": "ITEM_NOT_RECEIVED",
  "item not as described": "ITEM_NOT_AS_DESCRIBED",
  "damaged on arrival": "ITEM_DAMAGED",
  "wrong item": "WRONG_ITEM",
  "delivery issue": "DELIVERY_ISSUE",
  "contract breach": "CONTRACT_BREACH",
};

export function reasonToCategory(reason: string): string {
  return REASON_TO_CATEGORY[reason.trim().toLowerCase()] ?? "OTHER";
}

export interface ThreadMessage {
  id: string;
  senderRole: "buyer" | "seller" | "admin";
  mine: boolean;
  text: string;
  isOffer: boolean;
  /** For offers: the amount refunded to the BUYER (the seller keeps the rest of their share). */
  offerAmount?: number;
  offerStatus?: "PENDING" | "ACCEPTED" | "REJECTED" | "COUNTERED" | "WITHDRAWN" | "EXPIRED";
  createdAt: string;
}

export type AdminResolution = "REFUND_BUYER" | "RELEASE_TO_SELLER" | "SPLIT";

export interface AdminDisputeDetail {
  dispute: Dispute & {
    buyerName: string;
    sellerName: string;
    itemName: string;
    buyerPays: number;
    sellerReceives: number;
    transactionStatus: string;
  };
  evidence: { id: string; role: string; type: string; url: string; description?: string; createdAt: string }[];
  messages: ThreadMessage[];
}

function mapMessage(m: Record<string, any>, viewer?: string): ThreadMessage { // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    id: String(m.id),
    senderRole: m.sender_role,
    mine: m.mine ?? (viewer ? m.sender_role === viewer : false),
    text: String(m.message ?? ""),
    isOffer: Boolean(m.is_offer),
    offerAmount: m.offer_amount != null ? Number(m.offer_amount) : undefined,
    offerStatus: m.offer_status ?? undefined,
    createdAt: toIso(m.created_at),
  };
}

export const disputesService = {
  async list(): Promise<Dispute[]> {
    if (env.useMockApi) return mockResolve([...MOCK_DISPUTES]);
    const rows = await apiClient.getList<Record<string, unknown>>("/disputes/my", "disputes");
    return rows.map(mapDispute);
  },

  async create(input: { transactionId: string; reason: string; description: string }): Promise<Dispute> {
    if (input.description.trim().length < 20) {
      return mockReject("Describe what went wrong in at least 20 characters.", 400, "VALIDATION_ERROR");
    }
    if (env.useMockApi) {
      const created: Dispute = {
        id: `d${Math.random().toString(36).slice(2, 8)}`,
        transactionId: input.transactionId,
        reason: input.reason,
        description: input.description,
        status: "open",
        createdAt: new Date().toISOString(),
        evidenceUrls: [],
      };
      MOCK_DISPUTES.unshift(created);
      return mockResolve(created);
    }
    const res = await apiClient.post<{ dispute_id: number }>("/disputes/raise", {
      transaction_id: input.transactionId,
      category: reasonToCategory(input.reason),
      description: input.description.trim(),
    });
    const full = await apiClient.get<{ dispute: Record<string, unknown> }>(`/disputes/${res.dispute_id}`);
    return mapDispute(full.dispute);
  },

  // ── The conversation between buyer and seller ──────────────

  async thread(id: string): Promise<{ messages: ThreadMessage[]; viewerRole: string }> {
    if (env.useMockApi) return mockResolve({ messages: [], viewerRole: "buyer" });
    const r = await apiClient.get<{ messages: Record<string, unknown>[]; viewer_role: string }>(
      `/negotiation/${id}/messages`,
    );
    return { messages: r.messages.map((m) => mapMessage(m, r.viewer_role)), viewerRole: r.viewer_role };
  },

  async sendMessage(id: string, message: string): Promise<void> {
    if (env.useMockApi) return mockResolve<void>(undefined);
    await apiClient.post(`/negotiation/${id}/message`, { message });
  },

  /** `refundToBuyer` = whole shillings the buyer gets back; the seller keeps the rest. */
  async makeOffer(id: string, refundToBuyer: number, message: string): Promise<void> {
    if (env.useMockApi) return mockResolve<void>(undefined);
    await apiClient.post(`/negotiation/${id}/offer`, { offer_amount: Math.round(refundToBuyer), message });
  },

  async respondToOffer(
    disputeId: string,
    offerId: string,
    response: "ACCEPTED" | "REJECTED" | "COUNTERED",
    counterAmount?: number,
  ): Promise<void> {
    if (env.useMockApi) return mockResolve<void>(undefined);
    await apiClient.post(`/negotiation/${disputeId}/offer/${offerId}/respond`, {
      response,
      counter_amount: counterAmount != null ? Math.round(counterAmount) : undefined,
    });
  },

  async escalate(id: string): Promise<void> {
    if (env.useMockApi) return mockResolve<void>(undefined);
    await apiClient.post(`/disputes/${id}/escalate`);
  },

  async uploadEvidence(id: string, file: File, type: "photo" | "screenshot" | "document" | "tracking", description?: string): Promise<void> {
    if (env.useMockApi) return mockResolve<void>(undefined);
    const form = new FormData();
    form.append("file", file);
    form.append("evidence_type", type);
    if (description) form.append("description", description);
    await apiClient.postForm(`/disputes/${id}/evidence/upload`, form);
  },

  // ── Admin ──────────────────────────────────────────────────

  async adminList(status?: string): Promise<Dispute[]> {
    if (env.useMockApi) return mockResolve([...MOCK_DISPUTES]);
    const rows = await apiClient.getList<Record<string, unknown>>(
      `/admin/disputes${status ? `?status=${encodeURIComponent(status)}` : ""}`,
      "disputes",
    );
    return rows.map(mapDispute);
  },

  async adminDetail(id: string): Promise<AdminDisputeDetail> {
    if (env.useMockApi) return mockReject("Not available in mock mode", 404, "NOT_FOUND");
    const r = await apiClient.get<Record<string, any>>(`/admin/disputes/${id}`); // eslint-disable-line @typescript-eslint/no-explicit-any
    const d = r.dispute;
    return {
      dispute: {
        ...mapDispute(d),
        buyerName: d.buyer_name,
        sellerName: d.business_name || d.seller_name,
        itemName: d.item_name,
        buyerPays: Number(d.buyer_pays),
        sellerReceives: Number(d.seller_receives),
        transactionStatus: d.transaction_status,
      },
      evidence: (r.evidence ?? []).map((e: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
        id: String(e.id), role: e.submitted_by_role, type: e.evidence_type, url: e.file_url,
        description: e.description ?? undefined, createdAt: toIso(e.created_at),
      })),
      messages: (r.messages ?? []).map((m: Record<string, unknown>) => mapMessage(m)),
    };
  },

  /**
   * Admin final decision. The API moves the money (refund / release / split) in the same step;
   * the UI must NOT also change the transaction status.
   */
  async adminResolve(input: {
    id: string;
    resolution: AdminResolution;
    notes: string;
    splitBuyerAmount?: number;
    splitSellerAmount?: number;
  }): Promise<void> {
    if (env.useMockApi) return mockResolve<void>(undefined);
    await apiClient.post(`/admin/disputes/${input.id}/resolve`, {
      resolution: input.resolution,
      admin_notes: input.notes,
      split_buyer_amount: input.splitBuyerAmount,
      split_seller_amount: input.splitSellerAmount,
    });
  },

  /** Kept for the existing mock-mode admin screen. Real mode goes through `adminResolve`. */
  async resolve(input: { id: string; resolvedInFavorOf: "buyer" | "seller"; resolutionNote: string }): Promise<Dispute> {
    if (env.useMockApi) {
      const idx = MOCK_DISPUTES.findIndex((d) => d.id === input.id);
      if (idx === -1) throw new Error("Dispute not found");
      const updated: Dispute = {
        ...MOCK_DISPUTES[idx],
        status: "resolved",
        resolvedInFavorOf: input.resolvedInFavorOf,
        resolutionNote: input.resolutionNote,
        resolvedAt: new Date().toISOString(),
      };
      MOCK_DISPUTES[idx] = updated;
      return mockResolve(updated);
    }
    await disputesService.adminResolve({
      id: input.id,
      resolution: input.resolvedInFavorOf === "buyer" ? "REFUND_BUYER" : "RELEASE_TO_SELLER",
      notes: input.resolutionNote,
    });
    return { id: input.id, transactionId: "", reason: "", description: "", status: "resolved",
      createdAt: "", evidenceUrls: [], resolvedInFavorOf: input.resolvedInFavorOf, resolutionNote: input.resolutionNote };
  },
};
