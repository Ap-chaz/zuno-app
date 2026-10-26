/**
 * The ONE place where API payloads (snake_case, SQL-ish) become the shapes the UI
 * uses (types/models.ts). Services call these; components never see raw API data.
 */
import type { KycStatus, Transaction, TxStatus, User, ZunoRole, Dispute, DisputeStatus } from "@/types/models";

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function mapKycStatus(raw: unknown): KycStatus {
  switch (String(raw ?? "").toUpperCase()) {
    case "VERIFIED":
    case "APPROVED":
      return "verified";
    case "PENDING":
    case "SUBMITTED":
    case "UNDER_REVIEW":
    case "RESUBMITTED":
      return "pending";
    case "REJECTED":
      return "rejected";
    default:
      return "unverified";
  }
}

export function mapRole(raw: unknown): ZunoRole {
  return raw === "seller" || raw === "admin" ? raw : "buyer";
}

/** API user (login / verify-otp / profile) → UI user. Missing fields get safe defaults. */
export function mapUser(u: Raw): User {
  const name = String(u.full_name ?? u.name ?? "").trim() || "ZUNO User";
  return {
    id: String(u.id),
    name,
    email: u.email ?? "",
    phone: u.phone_number ?? u.phone ?? "",
    role: mapRole(u.role),
    kycStatus: u.is_verified ? "verified" : mapKycStatus(u.verification_status),
    phoneVerified: Boolean(u.phone_verified),
    sellerTier: Number(u.seller_tier ?? 0),
    trustScore: Number(u.trust_score ?? 0),
    avatarInitial: (name.charAt(0) || "?").toUpperCase(),
    createdAt: u.created_at ? toIso(u.created_at) : new Date().toISOString(),
  };
}

/**
 * The API sends naive server-time strings ("2026-10-24 19:03:00"). Treat them as UTC
 * (Railway runs UTC) and return ISO-8601; format in Africa/Nairobi on screen.
 */
export function toIso(raw: unknown): string {
  if (!raw) return "";
  const s = String(raw);
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(s)) return new Date(s).toISOString();
  return new Date(s.replace(" ", "T") + "Z").toISOString();
}

export function formatDateNairobi(iso: string, withTime = false): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: "Africa/Nairobi",
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(iso));
}

/** Parses either an ISO timestamp (real API) or a DD/MM/YYYY demo date. Never returns an invalid Date. */
export function parseAnyDate(d: string): Date {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d ?? "");
  const date = m ? new Date(`${m[3]}-${m[2]}-${m[1]}`) : new Date(d);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

/** Short display date for lists, whatever format the value came in. */
export function displayDate(d: string): string {
  const date = parseAnyDate(d);
  return date.getTime() === 0 ? "" : formatDateNairobi(date.toISOString());
}

// ── Transactions ─────────────────────────────────────────────

/** Statuses the API really has. The UI shows them 1:1; nothing is collapsed any more. */
export type ApiTxStatus =
  | "PENDING" | "FUNDED" | "IN_TRANSIT" | "INSPECTION" | "COMPLETED"
  | "DISPUTED" | "REFUNDED" | "RESOLVED" | "CANCELLED";

const TX_STATUS: Record<string, TxStatus> = {
  PENDING: "Pending",
  FUNDED: "Funded",
  IN_TRANSIT: "In transit",
  INSPECTION: "Inspection",
  COMPLETED: "Completed",
  DISPUTED: "Disputed",
  REFUNDED: "Refunded",
  RESOLVED: "Resolved",
  CANCELLED: "Cancelled",
};

export function mapTxStatus(raw: unknown): TxStatus {
  return TX_STATUS[String(raw ?? "").toUpperCase()] ?? "Pending";
}

export function mapTransaction(t: Raw): Transaction {
  const amount = Number(t.amount ?? 0);
  return {
    id: String(t.id ?? t.transaction_id),
    item: String(t.item_name ?? ""),
    seller: String(t.seller_name ?? t.business_name ?? "Seller"),
    sellerId: String(t.seller_id ?? ""),
    buyerName: t.buyer_name ?? undefined,
    amount,
    currency: "KES",
    date: toIso(t.created_at),
    status: mapTxStatus(t.status),
    category: String(t.category ?? "General"),
    buyerPays: Number(t.buyer_pays ?? amount),
    sellerReceives: Number(t.seller_receives ?? amount),
    platformFee: Number(t.platform_fee ?? t.total_fee ?? 0),
    buyerFeeShare: Number(t.buyer_fee_share ?? 0),
    sellerFeeShare: Number(t.seller_fee_share ?? 0),
    deliveryMethod: t.delivery_method ?? undefined,
    trackingNumber: t.tracking_number ?? undefined,
    courierName: t.courier_name ?? undefined,
    inspectionEndsAt: t.inspection_ends_at ? toIso(t.inspection_ends_at) : undefined,
    mpesaReference: t.payment_reference ?? undefined,
    payoutStatus: t.payout_status ? (t.payout_status === "COMPLETED" ? "paid" : "pending") : undefined,
  };
}

// ── Disputes ─────────────────────────────────────────────────

const DISPUTE_STATUS: Record<string, DisputeStatus> = {
  OPEN: "open",
  EVIDENCE_COLLECTION: "open",
  NEGOTIATING: "negotiating",
  ESCALATED: "under_review",
  UNDER_REVIEW: "under_review",
  RESOLVED: "resolved",
};

export function mapDispute(d: Raw): Dispute {
  return {
    id: String(d.id),
    transactionId: String(d.transaction_id),
    reason: String(d.category ?? "OTHER").replace(/_/g, " ").toLowerCase(),
    description: String(d.description ?? ""),
    status: DISPUTE_STATUS[String(d.status ?? "").toUpperCase()] ?? "open",
    createdAt: toIso(d.created_at),
    evidenceUrls: [],
    resolvedInFavorOf:
      d.resolution === "REFUND_BUYER" ? "buyer" : d.resolution === "RELEASE_TO_SELLER" ? "seller" : undefined,
    resolution: d.resolution ?? undefined,
    splitBuyerAmount: d.split_buyer_amount != null ? Number(d.split_buyer_amount) : undefined,
    splitSellerAmount: d.split_seller_amount != null ? Number(d.split_seller_amount) : undefined,
    resolutionNote: d.admin_notes ?? undefined,
    resolvedAt: d.resolved_at ? toIso(d.resolved_at) : undefined,
  };
}
