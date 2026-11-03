import { apiClient } from "@/lib/api/client";
import { env } from "@/config/env";
import { mockResolve } from "@/lib/api/mock-adapter";
import { toIso } from "@/lib/api/mappers";
import { transactions as seedTransactions, sellers as seedSellers } from "@/lib/zuno-data";

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface AdminKycItem {
  id: string; sellerId: string; fullName: string; nationalId: string; dob?: string;
  idFrontUrl?: string; idBackUrl?: string; selfieUrl?: string;
  businessName?: string; businessType?: string; kraPin?: string;
  status: string; submittedAt: string; phone: string; email?: string;
}

export interface AdminUser {
  id: string; name: string; phone: string; email?: string; businessName?: string;
  role: "buyer" | "seller"; active: boolean; verified: boolean; phoneVerified: boolean;
  verificationStatus: string; tier: number; suspensionReason?: string; suspendedUntil?: string;
  createdAt: string; dealCount: number; disputeCount: number;
}

export interface AdminPayout {
  id: string; transactionId: string; type: "SELLER_RELEASE" | "BUYER_REFUND" | "SPLIT_SELLER" | "SPLIT_BUYER";
  amount: number; phone: string; status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "NEEDS_REVIEW";
  reference?: string; failureReason?: string; attempts: number; createdAt: string; completedAt?: string;
}

export interface AdminMetrics {
  total: number; completed: number; disputed: number; funded: number; pending: number;
  revenue: number; inEscrow: number; sellers: number; verifiedSellers: number; pendingKyc: number;
  disputes: number; resolvedDisputes: number; openDisputes: number;
}

export interface AdminTransaction {
  id: string; item: string; seller: string; buyer: string; status: string;
  buyerPays: number; sellerReceives: number; platformFee: number; createdAt: string;
}

const n = (v: unknown) => Number(v ?? 0);
const safeIso = (v: unknown): string => {
  try { return toIso(v); } catch { return ""; }
};

// Realistic mock KYC items for offline admin testing
const MOCK_KYC_QUEUE: AdminKycItem[] = [
  {
    id: "kyc_1",
    sellerId: "seller_kamau_01",
    fullName: "Brian Kamau Mwangi",
    nationalId: "34891023",
    dob: "1994-08-14",
    businessName: "Kamau Electronics Ltd",
    businessType: "Retail",
    kraPin: "A012938475P",
    status: "PENDING",
    submittedAt: new Date(Date.now() - 3600_000 * 4).toISOString(),
    phone: "+254712345678",
    email: "kamau@electronics.co.ke",
  },
  {
    id: "kyc_2",
    sellerId: "seller_wanjiku_02",
    fullName: "Faith Wanjiku Njoroge",
    nationalId: "31908472",
    dob: "1996-03-22",
    businessName: "Njoroge Apparel & Bags",
    businessType: "Fashion",
    kraPin: "P051283940L",
    status: "PENDING",
    submittedAt: new Date(Date.now() - 3600_000 * 18).toISOString(),
    phone: "+254722987654",
    email: "faith@njorogeapparel.ke",
  },
];

// Realistic mock payouts
const MOCK_PAYOUTS: AdminPayout[] = [
  {
    id: "pay_1",
    transactionId: "ZUNO7HG6FD5SA1",
    type: "SELLER_RELEASE",
    amount: 41437,
    phone: "+254700000003",
    status: "COMPLETED",
    reference: "QDF981KL02",
    attempts: 1,
    createdAt: "2026-06-03T14:20:00Z",
    completedAt: "2026-06-03T14:21:15Z",
  },
  {
    id: "pay_2",
    transactionId: "ZUNO5UI6OP7AS8",
    type: "SELLER_RELEASE",
    amount: 96038,
    phone: "+254700000001",
    status: "COMPLETED",
    reference: "QDF442MN90",
    attempts: 1,
    createdAt: "2026-05-25T11:05:00Z",
    completedAt: "2026-05-25T11:06:10Z",
  },
  {
    id: "pay_3",
    transactionId: "ZUNO9DF8GH7JK6",
    type: "BUYER_REFUND",
    amount: 165000,
    phone: "+254711888999",
    status: "NEEDS_REVIEW",
    failureReason: "Dispute under review - awaiting mediator resolution",
    attempts: 0,
    createdAt: "2026-05-20T16:30:00Z",
  },
];

export const adminService = {
  async kycQueue(): Promise<AdminKycItem[]> {
    if (env.useMockApi) return mockResolve([...MOCK_KYC_QUEUE]);
    const rows = await apiClient.getList<Raw>("/admin/kyc/pending", "pending_kyc");
    return rows.map((k) => ({
      id: String(k.id), sellerId: String(k.seller_id), fullName: k.full_name, nationalId: k.national_id_number,
      dob: k.date_of_birth ?? undefined, idFrontUrl: k.id_front_url ?? undefined, idBackUrl: k.id_back_url ?? undefined,
      selfieUrl: k.selfie_url ?? undefined, businessName: k.business_name ?? undefined,
      businessType: k.business_type ?? undefined, kraPin: k.kra_pin ?? undefined,
      status: k.status, submittedAt: toIso(k.submitted_at), phone: k.phone_number, email: k.email ?? undefined,
    }));
  },

  async reviewKyc(id: string, decision: "APPROVED" | "REJECTED", notes: string, rejectionReason?: string) {
    if (env.useMockApi) {
      const idx = MOCK_KYC_QUEUE.findIndex((k) => k.id === id);
      if (idx !== -1) MOCK_KYC_QUEUE.splice(idx, 1);
      return mockResolve(undefined);
    }
    await apiClient.post(`/admin/kyc/${id}/review`, {
      decision, review_notes: notes, rejection_reason: decision === "REJECTED" ? rejectionReason : null,
    });
  },

  async users(role?: "buyer" | "seller", q?: string): Promise<AdminUser[]> {
    if (env.useMockApi) {
      const sellerUsers: AdminUser[] = seedSellers.map((s, idx) => ({
        id: s.id,
        name: s.name,
        phone: s.links?.whatsapp?.replace("https://wa.me/", "+") || `+25470000000${idx + 1}`,
        email: `contact@${s.id}.co.ke`,
        businessName: s.name,
        role: "seller",
        active: !s.suspended,
        verified: s.verified,
        phoneVerified: true,
        verificationStatus: s.verificationTier || "verified",
        tier: 1,
        createdAt: "2026-01-15T00:00:00Z",
        dealCount: s.deals,
        disputeCount: s.disputeCount ?? 0,
      }));

      const buyerUsers: AdminUser[] = seedTransactions.map((t, idx) => ({
        id: `buyer_${idx + 1}`,
        name: t.buyerName || `Buyer ${idx + 1}`,
        phone: `+25471100000${idx + 1}`,
        email: `${(t.buyerName || "buyer").toLowerCase().replace(/\s+/g, ".")}@example.com`,
        role: "buyer",
        active: true,
        verified: true,
        phoneVerified: true,
        verificationStatus: "verified",
        tier: 1,
        createdAt: "2026-02-01T00:00:00Z",
        dealCount: 3,
        disputeCount: t.status === "Disputed" ? 1 : 0,
      }));

      let all = [...sellerUsers, ...buyerUsers];
      if (role) all = all.filter((u) => u.role === role);
      if (q) {
        const query = q.toLowerCase();
        all = all.filter((u) => u.name.toLowerCase().includes(query) || u.phone.includes(query));
      }
      return mockResolve(all);
    }
    const qs = new URLSearchParams();
    if (role) qs.set("role", role);
    if (q) qs.set("q", q);
    const rows = await apiClient.getList<Raw>(`/admin/users?${qs}`, "users");
    return rows.map((u) => ({
      id: String(u.id), name: u.full_name, phone: u.phone_number, email: u.email ?? undefined,
      businessName: u.business_name ?? undefined, role: u.role, active: Boolean(u.is_active),
      verified: Boolean(u.is_verified), phoneVerified: Boolean(u.phone_verified),
      verificationStatus: u.verification_status, tier: n(u.seller_tier),
      suspensionReason: u.suspension_reason ?? undefined, suspendedUntil: u.suspended_until ?? undefined,
      createdAt: toIso(u.created_at), dealCount: n(u.deal_count), disputeCount: n(u.dispute_count),
    }));
  },

  async setTier(userId: string, tier: 1 | 2, notes: string) {
    if (env.useMockApi) return mockResolve(undefined);
    await apiClient.post(`/admin/users/${userId}/tier`, { tier, notes });
  },
  async setListing(userId: string, listed: boolean) {
    if (env.useMockApi) return mockResolve(undefined);
    await apiClient.post(`/admin/users/${userId}/listing`, { listed });
  },
  async suspend(userId: string, reason: string, days: number) {
    if (env.useMockApi) return mockResolve(undefined);
    await apiClient.post(`/admin/users/${userId}/suspend`, { reason, days });
  },
  async unsuspend(userId: string) {
    if (env.useMockApi) return mockResolve(undefined);
    await apiClient.post(`/admin/users/${userId}/unsuspend`);
  },

  async payouts(status?: string): Promise<AdminPayout[]> {
    if (env.useMockApi) {
      if (status) return mockResolve(MOCK_PAYOUTS.filter((p) => p.status === status));
      return mockResolve([...MOCK_PAYOUTS]);
    }
    const rows = await apiClient.getList<Raw>(`/admin/payouts${status ? `?status=${status}` : ""}`, "payouts");
    return rows.map((p) => ({
      id: String(p.id), transactionId: p.transaction_id, type: p.payout_type, amount: n(p.amount),
      phone: p.mpesa_number, status: p.status, reference: p.mpesa_reference ?? undefined,
      failureReason: p.failure_reason ?? undefined, attempts: n(p.attempts), createdAt: safeIso(p.created_at),
      completedAt: p.completed_at ? safeIso(p.completed_at) : undefined,
    }));
  },
  async retryPayout(id: string, confirmedNotPaid = false) {
    if (env.useMockApi) return mockResolve(undefined);
    await apiClient.post(`/admin/payouts/${id}/retry`, { confirmed_not_paid: confirmedNotPaid });
  },

  async transactions(status?: string, q?: string): Promise<AdminTransaction[]> {
    if (env.useMockApi) {
      let list: AdminTransaction[] = seedTransactions.map((t) => {
        const fee = Math.round(t.amount * 0.025);
        const buyerFee = Math.ceil(fee / 2);
        return {
          id: t.id,
          item: t.item,
          seller: t.seller,
          buyer: t.buyerName || "Buyer",
          status: t.status,
          buyerPays: t.amount + buyerFee,
          sellerReceives: t.amount - (fee - buyerFee),
          platformFee: fee,
          createdAt: new Date().toISOString(),
        };
      });
      if (status) list = list.filter((t) => t.status === status);
      if (q) {
        const query = q.toLowerCase();
        list = list.filter((t) => t.item.toLowerCase().includes(query) || t.seller.toLowerCase().includes(query) || t.id.toLowerCase().includes(query));
      }
      return mockResolve(list);
    }
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (q) qs.set("q", q);
    const rows = await apiClient.getList<Raw>(`/admin/transactions?${qs}`, "transactions");
    return rows.map((t) => ({
      id: t.id, item: t.item_name, seller: t.seller_business || t.seller_name, buyer: t.buyer_name ?? "",
      status: t.status, buyerPays: n(t.buyer_pays), sellerReceives: n(t.seller_receives),
      platformFee: n(t.platform_fee), createdAt: toIso(t.created_at),
    }));
  },

  async metrics(): Promise<AdminMetrics> {
    if (env.useMockApi) {
      const completedTxs = seedTransactions.filter((t) => t.status === "Completed");
      const disputedTxs = seedTransactions.filter((t) => t.status === "Disputed");
      const fundedTxs = seedTransactions.filter((t) => t.status === "Funded" || t.status === "Protected");
      const pendingTxs = seedTransactions.filter((t) => t.status === "Pending");
      
      const inEscrow = seedTransactions
        .filter((t) => ["Funded", "Protected", "In transit", "Inspection", "Disputed"].includes(t.status))
        .reduce((sum, t) => sum + t.amount, 0);

      const revenue = completedTxs.reduce((sum, t) => sum + Math.round(t.amount * 0.025), 0);

      return mockResolve({
        total: seedTransactions.length,
        completed: completedTxs.length,
        disputed: disputedTxs.length,
        funded: fundedTxs.length,
        pending: pendingTxs.length,
        revenue,
        inEscrow,
        sellers: seedSellers.length,
        verifiedSellers: seedSellers.filter((s) => s.verified).length,
        pendingKyc: MOCK_KYC_QUEUE.length,
        disputes: disputedTxs.length,
        resolvedDisputes: 0,
        openDisputes: disputedTxs.length,
      });
    }
    const r = await apiClient.get<Raw>("/admin/metrics");
    return {
      total: n(r.transactions.total_transactions), completed: n(r.transactions.completed),
      disputed: n(r.transactions.disputed), funded: n(r.transactions.funded), pending: n(r.transactions.pending),
      revenue: n(r.transactions.total_revenue), inEscrow: n(r.transactions.funds_in_escrow),
      sellers: n(r.users.total_sellers), verifiedSellers: n(r.users.verified_sellers),
      pendingKyc: n(r.users.pending_verification), disputes: n(r.disputes.total_disputes),
      resolvedDisputes: n(r.disputes.resolved), openDisputes: n(r.disputes.open_disputes),
    };
  },
};
