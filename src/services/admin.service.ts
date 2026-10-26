import { apiClient } from "@/lib/api/client";
import { env } from "@/config/env";
import { mockResolve } from "@/lib/api/mock-adapter";
import { toIso } from "@/lib/api/mappers";

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

export const adminService = {
  async kycQueue(): Promise<AdminKycItem[]> {
    if (env.useMockApi) return mockResolve([]);
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
    if (env.useMockApi) return mockResolve(undefined);
    await apiClient.post(`/admin/kyc/${id}/review`, {
      decision, review_notes: notes, rejection_reason: decision === "REJECTED" ? rejectionReason : null,
    });
  },

  async users(role?: "buyer" | "seller", q?: string): Promise<AdminUser[]> {
    if (env.useMockApi) return mockResolve([]);
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
  async suspend(userId: string, reason: string, days: number) {
    if (env.useMockApi) return mockResolve(undefined);
    await apiClient.post(`/admin/users/${userId}/suspend`, { reason, days });
  },
  async unsuspend(userId: string) {
    if (env.useMockApi) return mockResolve(undefined);
    await apiClient.post(`/admin/users/${userId}/unsuspend`);
  },

  async payouts(status?: string): Promise<AdminPayout[]> {
    if (env.useMockApi) return mockResolve([]);
    const rows = await apiClient.getList<Raw>(`/admin/payouts${status ? `?status=${status}` : ""}`, "payouts");
    return rows.map((p) => ({
      id: String(p.id), transactionId: p.transaction_id, type: p.payout_type, amount: n(p.amount),
      phone: p.mpesa_number, status: p.status, reference: p.mpesa_reference ?? undefined,
      failureReason: p.failure_reason ?? undefined, attempts: n(p.attempts), createdAt: toIso(p.created_at),
      completedAt: p.completed_at ? toIso(p.completed_at) : undefined,
    }));
  },
  async retryPayout(id: string, confirmedNotPaid = false) {
    if (env.useMockApi) return mockResolve(undefined);
    await apiClient.post(`/admin/payouts/${id}/retry`, { confirmed_not_paid: confirmedNotPaid });
  },

  async transactions(status?: string, q?: string): Promise<AdminTransaction[]> {
    if (env.useMockApi) return mockResolve([]);
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
    if (env.useMockApi)
      return mockResolve({ total: 0, completed: 0, disputed: 0, funded: 0, pending: 0, revenue: 0, inEscrow: 0,
        sellers: 0, verifiedSellers: 0, pendingKyc: 0, disputes: 0, resolvedDisputes: 0, openDisputes: 0 });
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
