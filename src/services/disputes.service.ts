import { apiClient } from "@/lib/api/client";
import { mockReject } from "@/lib/api/mock-adapter";
import { mockResolve } from "@/lib/api/mock-adapter";
import { env } from "@/config/env";
import { mapDispute, toIso } from "@/lib/api/mappers";
import type { Dispute } from "@/types/models";

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

const MOCK_DISPUTES: Dispute[] = [
  {
    id: "d1",
    transactionId: "ZUNO9DF8GH7JK6",
    reason: "Item not as described",
    description: "The drone arrived with a standard 2453mAh battery instead of the Intelligent Flight Battery Plus (3850mAh) specified in the agreed contract.",
    status: "under_review",
    createdAt: "2026-05-20T09:00:00.000Z",
    evidenceUrls: [],
  },
];

const MOCK_MESSAGES: Record<string, ThreadMessage[]> = {
  d1: [
    {
      id: "m1",
      senderRole: "buyer",
      mine: false,
      text: "The drone package arrived today, but the battery enclosed is the standard 2453mAh pack. The contract agreed on the Intelligent Flight Battery Plus (3850mAh).",
      isOffer: false,
      createdAt: "2026-05-20T09:30:00.000Z",
    },
    {
      id: "m2",
      senderRole: "seller",
      mine: false,
      text: "Hello Peter, apologies for the warehouse oversight. The Plus battery shipment was delayed. We can offer an immediate KES 15,000 partial refund so you can purchase the Plus battery locally.",
      isOffer: true,
      offerAmount: 15000,
      offerStatus: "PENDING",
      createdAt: "2026-05-20T10:15:00.000Z",
    },
    {
      id: "m3",
      senderRole: "buyer",
      mine: false,
      text: "The standalone Plus battery costs KES 22,000 at DJI Nairobi retail. KES 15,000 is too low to cover the replacement cost.",
      isOffer: false,
      createdAt: "2026-05-20T11:00:00.000Z",
    },
  ],
};

const MOCK_EVIDENCE: Record<
  string,
  { id: string; role: string; type: string; url: string; description?: string; createdAt: string }[]
> = {
  d1: [
    {
      id: "ev1",
      role: "buyer",
      type: "photo",
      url: "https://images.unsplash.com/photo-1527977966376-1c8408f9f108?w=800&auto=format&fit=crop",
      description: "Photo of received retail box and standard 2453mAh battery serial",
      createdAt: "2026-05-20T09:15:00.000Z",
    },
    {
      id: "ev2",
      role: "seller",
      type: "document",
      url: "https://images.unsplash.com/photo-1554415707-9e4c0193af47?w=800&auto=format&fit=crop",
      description: "Dispatch delivery note & courier receipt",
      createdAt: "2026-05-20T10:20:00.000Z",
    },
  ],
};

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
    if (env.useMockApi) {
      return mockResolve({ messages: MOCK_MESSAGES[id] || [], viewerRole: "admin" });
    }
    const r = await apiClient.get<{ messages: Record<string, unknown>[]; viewer_role: string }>(
      `/negotiation/${id}/messages`,
    );
    return { messages: r.messages.map((m) => mapMessage(m, r.viewer_role)), viewerRole: r.viewer_role };
  },

  async sendMessage(id: string, message: string): Promise<void> {
    if (env.useMockApi) {
      if (!MOCK_MESSAGES[id]) MOCK_MESSAGES[id] = [];
      MOCK_MESSAGES[id].push({
        id: `m_${Date.now()}`,
        senderRole: "admin",
        mine: true,
        text: message,
        isOffer: false,
        createdAt: new Date().toISOString(),
      });
      return mockResolve<void>(undefined);
    }
    await apiClient.post(`/negotiation/${id}/message`, { message });
  },

  /** `refundToBuyer` = whole shillings the buyer gets back; the seller keeps the rest. */
  async makeOffer(id: string, refundToBuyer: number, message: string): Promise<void> {
    if (env.useMockApi) {
      if (!MOCK_MESSAGES[id]) MOCK_MESSAGES[id] = [];
      MOCK_MESSAGES[id].push({
        id: `m_${Date.now()}`,
        senderRole: "seller",
        mine: true,
        text: message,
        isOffer: true,
        offerAmount: Math.round(refundToBuyer),
        offerStatus: "PENDING",
        createdAt: new Date().toISOString(),
      });
      return mockResolve<void>(undefined);
    }
    await apiClient.post(`/negotiation/${id}/offer`, { offer_amount: Math.round(refundToBuyer), message });
  },

  async respondToOffer(
    disputeId: string,
    offerId: string,
    response: "ACCEPTED" | "REJECTED" | "COUNTERED",
    counterAmount?: number,
  ): Promise<void> {
    if (env.useMockApi) {
      const list = MOCK_MESSAGES[disputeId] || [];
      const off = list.find((m) => m.id === offerId);
      if (off) off.offerStatus = response;
      if (counterAmount) {
        list.push({
          id: `m_${Date.now()}`,
          senderRole: "buyer",
          mine: true,
          text: `Counter-offer: KES ${counterAmount.toLocaleString()}`,
          isOffer: true,
          offerAmount: counterAmount,
          offerStatus: "PENDING",
          createdAt: new Date().toISOString(),
        });
      }
      return mockResolve<void>(undefined);
    }
    await apiClient.post(`/negotiation/${disputeId}/offer/${offerId}/respond`, {
      response,
      counter_amount: counterAmount != null ? Math.round(counterAmount) : undefined,
    });
  },

  async escalate(id: string): Promise<void> {
    if (env.useMockApi) {
      const found = MOCK_DISPUTES.find((d) => d.id === id);
      if (found) found.status = "under_review";
      return mockResolve<void>(undefined);
    }
    await apiClient.post(`/disputes/${id}/escalate`);
  },

  async uploadEvidence(
    id: string,
    file: File,
    type: "photo" | "screenshot" | "document" | "tracking",
    description?: string,
  ): Promise<void> {
    if (env.useMockApi) {
      if (!MOCK_EVIDENCE[id]) MOCK_EVIDENCE[id] = [];
      MOCK_EVIDENCE[id].push({
        id: `ev_${Date.now()}`,
        role: "buyer",
        type,
        url: URL.createObjectURL(file),
        description: description || file.name,
        createdAt: new Date().toISOString(),
      });
      return mockResolve<void>(undefined);
    }
    const form = new FormData();
    form.append("file", file);
    form.append("evidence_type", type);
    if (description) form.append("description", description);
    await apiClient.postForm(`/disputes/${id}/evidence/upload`, form);
  },

  // ── Admin ──────────────────────────────────────────────────

  async adminList(status?: string): Promise<Dispute[]> {
    if (env.useMockApi) {
      if (status) return mockResolve(MOCK_DISPUTES.filter((d) => d.status === status));
      return mockResolve([...MOCK_DISPUTES]);
    }
    const rows = await apiClient.getList<Record<string, unknown>>(
      `/admin/disputes${status ? `?status=${encodeURIComponent(status)}` : ""}`,
      "disputes",
    );
    return rows.map(mapDispute);
  },

  async adminDetail(id: string): Promise<AdminDisputeDetail> {
    if (env.useMockApi) {
      const d = MOCK_DISPUTES.find((item) => item.id === id);
      if (!d) return mockReject(`Dispute ${id} not found`, 404, "NOT_FOUND");
      return mockResolve({
        dispute: {
          ...d,
          buyerName: "Peter Njoroge",
          sellerName: "Aerial KE",
          itemName: "DJI Mini 5 Pro",
          buyerPays: 169125,
          sellerReceives: 160875,
          transactionStatus: "Disputed",
        },
        evidence: MOCK_EVIDENCE[id] || [],
        messages: MOCK_MESSAGES[id] || [],
      });
    }
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
    if (env.useMockApi) {
      const found = MOCK_DISPUTES.find((d) => d.id === input.id);
      if (found) {
        found.status = "resolved";
        found.resolution = input.resolution;
        found.resolvedInFavorOf =
          input.resolution === "REFUND_BUYER"
            ? "buyer"
            : input.resolution === "RELEASE_TO_SELLER"
              ? "seller"
              : undefined;
        found.resolutionNote = input.notes;
        found.resolvedAt = new Date().toISOString();
        found.splitBuyerAmount = input.splitBuyerAmount;
        found.splitSellerAmount = input.splitSellerAmount;
      }
      if (!MOCK_MESSAGES[input.id]) MOCK_MESSAGES[input.id] = [];
      MOCK_MESSAGES[input.id].push({
        id: `m_${Date.now()}`,
        senderRole: "admin",
        mine: true,
        text: `Mediator Resolution (${input.resolution}): ${input.notes}`,
        isOffer: false,
        createdAt: new Date().toISOString(),
      });
      return mockResolve<void>(undefined);
    }
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
    return {
      id: input.id,
      transactionId: "",
      reason: "",
      description: "",
      status: "resolved",
      createdAt: "",
      evidenceUrls: [],
      resolvedInFavorOf: input.resolvedInFavorOf,
      resolutionNote: input.resolutionNote,
    };
  },
};

export { ApiError } from "@/lib/api/client";
