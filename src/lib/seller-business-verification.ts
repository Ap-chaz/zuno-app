// Client-side business verification status for the SELLER's own submission.
// Same "prototype only" caveat as zuno-kyc.ts: in production, submission must
// go to a real endpoint and an admin queue, and this status must be mirrored
// server-side before a seller is allowed to display / accept escrow deals.

import { useAuth } from "@/hooks/useAuth";
import type { SellerVerificationTier } from "@/types/models";

export interface BusinessVerificationSubmission {
  category: string;
  businessRegNumber: string;
  kraPin: string;
  location: string;
  businessPhone: string;
  payoutMethod: "mpesa" | "bank";
  payoutDetails: string;
  payoutBankName?: string;
  documentName: string;
  submittedAt: string;
}

const TIER_KEY = "zuno_seller_verification_tier";
const SUBMISSION_KEY = "zuno_seller_verification_submission";

function safeWindow(): Window | null {
  return typeof window === "undefined" ? null : window;
}

export function getSellerVerificationTier(): SellerVerificationTier {
  const w = safeWindow();
  if (!w) return "unverified";
  try {
    const v = w.localStorage.getItem(TIER_KEY);
    if (v === "verified" || v === "pending" || v === "flagged") return v;
    return "unverified";
  } catch {
    return "unverified";
  }
}

export function submitBusinessVerification(data: BusinessVerificationSubmission) {
  const w = safeWindow();
  if (!w) return;
  try {
    w.localStorage.setItem(SUBMISSION_KEY, JSON.stringify(data));
    w.localStorage.setItem(TIER_KEY, "pending" satisfies SellerVerificationTier);
  } catch {}
}

export function getSellerVerificationSubmission(): BusinessVerificationSubmission | null {
  const w = safeWindow();
  if (!w) return null;
  try {
    const v = w.localStorage.getItem(SUBMISSION_KEY);
    return v ? (JSON.parse(v) as BusinessVerificationSubmission) : null;
  } catch {
    return null;
  }
}

/**
 * Admin-only: approve, reject, or revoke the current device's business
 * verification. This is what actually switches a seller from the Basic
 * dashboard to the full Business dashboard (see seller.index.tsx).
 *
 * Same "prototype only" limitation as the rest of this file: there's no
 * real backend, so this only affects the browser it's called from. In a
 * real deployment this becomes a server-side status change that the
 * seller's own session then reads on next load.
 */
export function setSellerVerificationTier(tier: SellerVerificationTier) {
  const w = safeWindow();
  if (!w) return;
  try {
    w.localStorage.setItem(TIER_KEY, tier);
  } catch {}
}

/** Clears a submission entirely (e.g. after a rejection the seller must resubmit). */
export function clearSellerVerificationSubmission() {
  const w = safeWindow();
  if (!w) return;
  try {
    w.localStorage.removeItem(SUBMISSION_KEY);
    w.localStorage.removeItem(TIER_KEY);
  } catch {}
}


/**
 * The seller's business level as the SERVER reports it (Tier 2 = business verified by an admin).
 * Nothing here can be changed from the browser.
 */
export function useSellerTier(): SellerVerificationTier {
  const { user } = useAuth();
  return (user?.sellerTier ?? 0) >= 2 ? "verified" : "unverified";
}
