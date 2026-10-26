import { apiClient } from "@/lib/api/client";
import { mockResolve, mockReject } from "@/lib/api/mock-adapter";
import { env } from "@/config/env";
import { toIso } from "@/lib/api/mappers";

export type ContractStatus = "SELLER_REVIEWING" | "AGREED" | "REJECTED" | "EXPIRED" | "CANCELLED" | string;

export interface Contract {
  id: string;
  status: ContractStatus;
  /** Which side of this contract the signed-in person is on. */
  viewerRole: "buyer" | "seller" | "admin";
  sellerId: string;
  buyerName: string;
  itemName: string;
  itemDescription: string;
  amount: number;
  buyerExpectations: string;
  deliveryMethod: string;
  pickupLocation?: string;
  deliveryLocation?: string;
  sellerConfirmation?: string;
  createdAt: string;
  expiresAt: string;
}

export interface CreateContractInput {
  sellerId: string;
  itemName: string;
  itemDescription?: string;
  amount: number;
  buyerExpectations: string;
  deliveryMethod: string;
  pickupLocation?: string;
  deliveryLocation?: string;
}

export const DELIVERY_METHODS = [
  { id: "PLATFORM_COURIER", label: "Zuno courier" },
  { id: "SELLER_ARRANGED", label: "Seller delivers (own courier)" },
  { id: "BUYER_ARRANGED", label: "I arrange pickup/courier" },
  { id: "IN_PERSON", label: "Meet in person" },
] as const;

function mapContract(c: Record<string, any>): Contract { // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    id: String(c.id),
    status: String(c.status),
    viewerRole: c.viewer_role ?? "buyer",
    sellerId: String(c.seller_id),
    buyerName: String(c.buyer_name ?? ""),
    itemName: String(c.item_name ?? ""),
    itemDescription: String(c.item_description ?? ""),
    amount: Number(c.agreed_amount ?? 0),
    buyerExpectations: String(c.buyer_expectations ?? ""),
    deliveryMethod: String(c.delivery_method ?? ""),
    pickupLocation: c.pickup_location || undefined,
    deliveryLocation: c.delivery_location || undefined,
    sellerConfirmation: c.seller_confirmation || undefined,
    createdAt: toIso(c.created_at),
    expiresAt: toIso(c.expires_at),
  };
}

const MOCK: Contract[] = [];

export const contractsService = {
  async list(): Promise<Contract[]> {
    if (env.useMockApi) return mockResolve([...MOCK]);
    const rows = await apiClient.getList<Record<string, unknown>>("/contracts/my", "contracts");
    return rows.map(mapContract);
  },

  async create(input: CreateContractInput): Promise<{ id: string; expiresAt: string }> {
    if (input.amount < 100) return mockReject("The minimum deal is Ksh 100.", 400, "VALIDATION_ERROR");
    if (input.buyerExpectations.trim().length < 20) {
      return mockReject("Describe what you expect in at least 20 characters.", 400, "VALIDATION_ERROR");
    }
    if (env.useMockApi) {
      const c: Contract = {
        id: String(MOCK.length + 1),
        status: "SELLER_REVIEWING",
        viewerRole: "buyer",
        sellerId: input.sellerId,
        buyerName: "You",
        itemName: input.itemName,
        itemDescription: input.itemDescription ?? "",
        amount: input.amount,
        buyerExpectations: input.buyerExpectations,
        deliveryMethod: input.deliveryMethod,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
      };
      MOCK.unshift(c);
      return mockResolve({ id: c.id, expiresAt: c.expiresAt });
    }
    const res = await apiClient.post<{ contract_id: number; expires_at: string }>("/contracts/create", {
      seller_id: Number(input.sellerId),
      item_name: input.itemName,
      item_description: input.itemDescription,
      agreed_amount: Math.round(input.amount),
      buyer_expectations: input.buyerExpectations,
      delivery_method: input.deliveryMethod,
      pickup_location: input.pickupLocation,
      delivery_location: input.deliveryLocation,
    });
    return { id: String(res.contract_id), expiresAt: toIso(res.expires_at) };
  },

  /** Seller accepts the buyer's terms in writing. */
  async confirm(id: string, statement: string): Promise<void> {
    if (env.useMockApi) return mockResolve<void>(undefined);
    await apiClient.post(`/contracts/${id}/confirm`, { seller_confirmation: statement });
  },

  async reject(id: string, reason: string): Promise<void> {
    if (env.useMockApi) return mockResolve<void>(undefined);
    await apiClient.post(`/contracts/${id}/reject`, { reason });
  },

  /** Seller: turn an agreed contract into a payable transaction (the buyer is texted the payment link). */
  async createTransaction(contractId: string): Promise<{ transactionId: string; paymentLink: string }> {
    if (env.useMockApi) return mockResolve({ transactionId: `ZNO-MOCK-${contractId}`, paymentLink: "" });
    const res = await apiClient.post<{ transaction_id: string; payment_link: string }>("/transactions/create", {
      contract_id: Number(contractId),
    });
    return { transactionId: res.transaction_id, paymentLink: res.payment_link };
  },
};
