/**
 * Domain models shared between services, hooks, and UI.
 *
 * Keeping these separate from `lib/zuno-data.ts` (the mock dataset) means
 * the "shape a component expects" and "shape the mock happens to store" can
 * diverge cleanly once a real API is introduced — components only ever
 * depend on the types in this file.
 */

export type TxStatus =
  | "Pending"
  | "Funded"
  | "Protected"
  | "In transit"
  | "Inspection"
  | "Completed"
  | "Refunded"
  | "Resolved"
  | "Cancelled"
  | "Disputed";

export interface Transaction {
  id: string;
  item: string;
  seller: string;
  sellerId: string;
  /** Buyer's display name. Optional because older seed rows predate this field. */
  buyerName?: string;
  amount: number;
  currency: "KES";
  date: string;
  status: TxStatus;
  category: string;
  /** Admin-only: marked for manual fraud review. Not shown to buyers/sellers. */
  flaggedForReview?: boolean;
  /**
   * Whether the actual money movement has happened yet — releasing escrow
   * (status = Completed/Refunded) doesn't itself send an M-Pesa/bank
   * transfer until there's a real payment integration. Admin marks this once
   * they've manually sent the seller payout or buyer refund. Undefined/
   * "pending" for anything not yet in a payable state.
   */
  payoutStatus?: "pending" | "paid";
  // ── Filled by the real API (all amounts are whole KES, calculated server-side) ──
  buyerPays?: number;
  sellerReceives?: number;
  platformFee?: number;
  buyerFeeShare?: number;
  sellerFeeShare?: number;
  deliveryMethod?: string;
  trackingNumber?: string;
  courierName?: string;
  /** ISO time the buyer's inspection window closes (funds auto-release after this). */
  inspectionEndsAt?: string;
  mpesaReference?: string;
}

export type SellerVerificationTier = "unverified" | "pending" | "verified" | "flagged";

export interface Seller {
  id: string;
  name: string;
  initials: string;
  rating: number;
  reviews: number;
  category: string;
  verified: boolean;
  /** Finer-grained status than `verified` — drives the display gate and admin queue. */
  verificationTier?: SellerVerificationTier;
  /** Count of unresolved/upheld disputes against this seller. */
  disputeCount?: number;
  deals: number;
  tagline: string;
  color: string;
  location?: string;
  description?: string;
  responseRate?: number;
  /** Where seller payouts should be sent — captured during business verification. */
  payoutMethod?: "mpesa" | "bank";
  payoutDetails?: string;
  payoutBankName?: string;
  /** Admin-only: account suspended, hidden from buyer listings regardless of verification tier. */
  suspended?: boolean;
  links?: {
    instagram?: string;
    facebook?: string;
    tiktok?: string;
    whatsapp?: string;
    website?: string;
  };
}

export type KycStatus = "unverified" | "pending" | "verified" | "rejected";

export type ZunoRole = "buyer" | "seller" | "admin";

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: ZunoRole;
  kycStatus: KycStatus;
  /** Server-confirmed: the phone number was proven with an SMS code. */
  phoneVerified: boolean;
  /** 0 = unverified (small deals), 1 = KYC approved, 2 = business verified. */
  sellerTier: number;
  trustScore: number;
  avatarInitial: string;
  createdAt: string;
}

export interface AuthSession {
  user: User;
  /** Opaque bearer token — never parsed on the client. */
  token: string;
}

export type SupportTicketStatus = "open" | "resolved";

export interface SupportTicket {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: SupportTicketStatus;
  createdAt: string;
}

/**
 * There's no real multi-buyer user table yet (auth only tracks the single
 * logged-in user). This is derived from transaction history instead —
 * grouped by buyerName — so admin has something real to work with rather
 * than inventing a parallel fake dataset. Once a real user table exists,
 * swap this for an actual buyers endpoint.
 */
export interface BuyerSummary {
  name: string;
  transactionCount: number;
  totalSpent: number;
  disputeCount: number;
  lastTransactionDate: string;
  suspended: boolean;
  kycStatus: KycStatus;
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  type: "transaction" | "dispute" | "system" | "kyc";
  relatedId?: string;
}

export type DisputeStatus = "open" | "negotiating" | "under_review" | "resolved" | "rejected";

export interface Dispute {
  id: string;
  transactionId: string;
  reason: string;
  description: string;
  status: DisputeStatus;
  createdAt: string;
  evidenceUrls: string[];
  /** Set once an admin resolves the dispute — who the funds decision favored. */
  resolvedInFavorOf?: "buyer" | "seller";
  /** Exact admin/negotiation outcome: REFUND_BUYER | RELEASE_TO_SELLER | SPLIT. */
  resolution?: string;
  splitBuyerAmount?: number;
  splitSellerAmount?: number;
  /** Admin's note explaining the resolution, shown to both parties. */
  resolutionNote?: string;
  resolvedAt?: string;
}

export interface TrackingEvent {
  id: string;
  label: string;
  description: string;
  timestamp: string;
  completed: boolean;
}

/**
 * Generic wrapper every service call resolves to. Mirrors a typical REST
 * envelope so swapping the mock adapter for `fetch` doesn't change the
 * calling code's shape.
 */
export interface ApiResult<T> {
  data: T;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
