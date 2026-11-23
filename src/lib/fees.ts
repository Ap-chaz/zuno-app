/**
 * ZUNO fee system — category tiering, fee calculation, and KES formatting.
 *
 * Single source of truth for pricing. Import this anywhere a fee needs to be
 * shown or calculated (Pricing page, homepage summary, and eventually the
 * real listing/checkout flow in the product app) instead of re-deriving
 * numbers locally.
 */

export type FeeTierId = "low" | "medium" | "high";

export interface FeeTier {
  id: FeeTierId;
  label: string;
  /** Total fee as a decimal, e.g. 0.01 for 1%. Split 50/50 between buyer and seller. */
  feePct: number;
  description: string;
}

/**
 * Medium tier is specified as a 1.5–2% range rather than a fixed number.
 * 1.75% (the midpoint) is used as the flat default — see the categories
 * below for which items sit in this tier. Flagged for confirmation: this
 * could instead be split into two sub-bands (e.g. fashion/home goods at
 * 1.5%, collectibles/used electronics at 2%) if finer granularity is wanted.
 */
export const FEE_TIERS: Record<FeeTierId, FeeTier> = {
  low: {
    id: "low",
    label: "Low risk",
    feePct: 0.01,
    description: "Standardized, easy-to-verify goods",
  },
  medium: {
    id: "medium",
    label: "Medium risk",
    feePct: 0.0175,
    description: "General goods — moderate dispute likelihood",
  },
  high: {
    id: "high",
    label: "High risk",
    feePct: 0.025,
    description: "High-value, hard-to-verify, or dispute-prone",
  },
};

export const FEE_TIER_ORDER: FeeTierId[] = ["low", "medium", "high"];

export interface Category {
  id: string;
  label: string;
  tier: FeeTierId;
}

/**
 * ZUNO's real supported use cases, mapped to a tier. Edge cases and the
 * reasoning behind them:
 *
 * - "New / sealed electronics" vs "Used / secondhand electronics" are split
 *   across low and medium — condition is easy to verify when sealed, but
 *   becomes a subjective, dispute-prone judgment call once a device has been
 *   used. Flagged: confirm this split matches intent, since the original
 *   brief listed "electronics" only under low risk.
 * - Jewelry & luxury goods sit in high risk (high value + hard to verify
 *   authenticity), consistent with the existing pricing page's prior
 *   categorization.
 * - Freelance/service deliverables, vehicles, property deposits, and custom
 *   items are high risk exactly as specified in the brief.
 */
export const CATEGORIES: Category[] = [
  { id: "electronics-new", label: "New / sealed electronics", tier: "low" },
  { id: "general-merchandise", label: "General merchandise & everyday items", tier: "low" },
  { id: "books-media", label: "Books & media", tier: "low" },

  { id: "fashion", label: "Fashion & apparel", tier: "medium" },
  { id: "home-goods", label: "Home goods & furniture", tier: "medium" },
  { id: "collectibles", label: "Collectibles & hobby items", tier: "medium" },
  { id: "electronics-used", label: "Used / secondhand electronics", tier: "medium" },

  { id: "vehicles", label: "Vehicles", tier: "high" },
  { id: "property-deposit", label: "Property deposits (rental or sale)", tier: "high" },
  { id: "freelance-services", label: "Freelance & service deliverables", tier: "high" },
  { id: "custom-items", label: "Custom / commissioned items", tier: "high" },
  { id: "jewelry-luxury", label: "Jewelry & luxury goods", tier: "high" },
];

export function getCategory(categoryId: string): Category | undefined {
  return CATEGORIES.find((c) => c.id === categoryId);
}

export function getTierForCategory(categoryId: string): FeeTier {
  const category = getCategory(categoryId);
  return category ? FEE_TIERS[category.tier] : FEE_TIERS.medium;
}

export interface FeeCalculation {
  itemPrice: number;
  tier: FeeTier;
  /** Total fee as a decimal, e.g. 0.01 for 1%. */
  totalFeePct: number;
  totalFeeAmount: number;
  buyerFeeShare: number;
  sellerFeeShare: number;
  /** item price + buyer's half of the fee */
  buyerDeposit: number;
  /** item price − seller's half of the fee */
  sellerPayout: number;
}

/**
 * Core fee calculation. Total fee is split 50/50 between buyer and seller:
 * buyer deposits item price + half the fee, seller receives item price
 * minus half the fee.
 */
export function calculateFee(itemPrice: number, categoryId: string): FeeCalculation {
  const tier = getTierForCategory(categoryId);
  const price = Math.max(0, itemPrice);
  const totalFeeAmount = price * tier.feePct;
  const half = totalFeeAmount / 2;

  return {
    itemPrice: price,
    tier,
    totalFeePct: tier.feePct,
    totalFeeAmount,
    buyerFeeShare: half,
    sellerFeeShare: half,
    buyerDeposit: price + half,
    sellerPayout: price - half,
  };
}

/** Same calculation, but by tier id directly rather than a category — useful for showing one example per tier. */
export function calculateFeeForTier(itemPrice: number, tierId: FeeTierId): FeeCalculation {
  const tier = FEE_TIERS[tierId];
  const price = Math.max(0, itemPrice);
  const totalFeeAmount = price * tier.feePct;
  const half = totalFeeAmount / 2;

  return {
    itemPrice: price,
    tier,
    totalFeePct: tier.feePct,
    totalFeeAmount,
    buyerFeeShare: half,
    sellerFeeShare: half,
    buyerDeposit: price + half,
    sellerPayout: price - half,
  };
}

export const FLAT_FEE_PCT = 0.025; // 2.5%
export const BUYER_SHARE_PCT = 0.0125; // 1.25%
export const SELLER_SHARE_PCT = 0.0125; // 1.25%
export const MIN_FEE_KES = 2;

export function calculateFlatFee(itemPrice: number) {
  const price = Math.max(0, itemPrice);
  const rawFee = price * FLAT_FEE_PCT;
  const totalFeeAmount = price > 0 ? Math.max(MIN_FEE_KES, Math.round(rawFee)) : 0;
  const buyerFeeShare = Math.ceil(totalFeeAmount / 2);
  const sellerFeeShare = totalFeeAmount - buyerFeeShare;

  return {
    itemPrice: price,
    totalFeePct: FLAT_FEE_PCT,
    totalFeeAmount,
    buyerFeeShare,
    sellerFeeShare,
    buyerDeposit: price + buyerFeeShare,
    sellerPayout: Math.max(0, price - sellerFeeShare),
  };
}

export function formatFeePct(pct: number): string {
  return `${(pct * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}

export function formatKES(amount: number): string {
  return `KES ${amount.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
