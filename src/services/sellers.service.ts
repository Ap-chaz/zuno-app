import { apiClient } from "@/lib/api/client";
import { mockResolve, mockReject } from "@/lib/api/mock-adapter";
import { env } from "@/config/env";
import { sellers as seedSellers, categories as seedCategories } from "@/lib/zuno-data";
import type { Seller } from "@/types/models";

// Adapts the shared seed data (see transactions.service.ts for the rationale).
const MOCK_SELLERS: Seller[] = seedSellers;

const PALETTE = ["#7c3aed", "#d4a017", "#0ea5e9", "#10b981", "#f43f5e", "#f97316"];

function mapSeller(r: Record<string, any>): Seller { // eslint-disable-line @typescript-eslint/no-explicit-any
  const name = String(r.display_name ?? r.business_name ?? r.full_name ?? "Seller");
  const id = String(r.id);
  return {
    id,
    name,
    initials: name.split(/\s+/).map((w: string) => w[0]).slice(0, 2).join("").toUpperCase(),
    rating: Number(r.average_rating ?? 0),
    reviews: Number(r.total_ratings ?? 0),
    category: "General",
    verified: Boolean(r.is_verified),
    verificationTier: r.is_verified ? "verified" : "unverified",
    deals: Number(r.completed_transactions ?? 0),
    tagline: String(r.bio ?? ""),
    color: PALETTE[Number(id) % PALETTE.length],
  };
}

export const SELLER_CATEGORIES = seedCategories;

export const sellersService = {
  /** Verified Sellers directory: only sellers an admin has listed. */
  async list(): Promise<Seller[]> {
    if (env.useMockApi) return mockResolve(MOCK_SELLERS.filter((s) => s.verified));
    const rows = await apiClient.getList<Record<string, any>>("/sellers", "sellers"); // eslint-disable-line @typescript-eslint/no-explicit-any
    return rows.map(mapSeller);
  },

  /** Everyone a buyer may start a deal with (New Escrow dropdown). Not limited to verified sellers. */
  async listAll(): Promise<Seller[]> {
    if (env.useMockApi) return mockResolve([...MOCK_SELLERS]);
    const rows = await apiClient.getList<Record<string, any>>("/sellers?all=1", "sellers"); // eslint-disable-line @typescript-eslint/no-explicit-any
    return rows.map(mapSeller);
  },

  /**
   * Search-as-you-type for the New Escrow seller picker. Returns at most `limit`
   * matches among every active, phone-verified seller (not only the directory).
   * An empty query returns the top sellers so the list is never blank.
   */
  async searchBookable(query: string, limit = 10): Promise<Seller[]> {
    const q = query.trim();
    if (env.useMockApi) {
      const needle = q.toLowerCase();
      return mockResolve(MOCK_SELLERS.filter((s) => !needle || s.name.toLowerCase().includes(needle)).slice(0, limit));
    }
    const params = new URLSearchParams({ all: "1", limit: String(limit) });
    if (q) params.set("q", q);
    const rows = await apiClient.getList<Record<string, any>>(`/sellers?${params.toString()}`, "sellers"); // eslint-disable-line @typescript-eslint/no-explicit-any
    return rows.map(mapSeller);
  },

  async getById(id: string): Promise<Seller> {
    if (env.useMockApi) {
      const found = MOCK_SELLERS.find((s) => s.id === id);
      if (!found) return mockReject(`Seller ${id} not found`, 404, "NOT_FOUND");
      return mockResolve(found);
    }
    const r = await apiClient.get<{ seller: Record<string, any> }>(`/sellers/${id}`); // eslint-disable-line @typescript-eslint/no-explicit-any
    return mapSeller(r.seller);
  },

  async search(query: string, category = "All"): Promise<Seller[]> {
    const all = await this.list();
    const q = query.trim().toLowerCase();
    return all.filter((s) => {
      const matchesCategory = category === "All" || s.category === category;
      const matchesQuery =
        !q || s.name.toLowerCase().includes(q) || s.tagline.toLowerCase().includes(q);
      return matchesCategory && matchesQuery;
    });
  },

  /** Admin-only: suspend hides a seller from buyer listings regardless of verification tier. */
  async toggleSuspend(id: string, suspended: boolean): Promise<Seller> {
    if (env.useMockApi) {
      const found = MOCK_SELLERS.find((s) => s.id === id);
      if (!found) return mockReject(`Seller ${id} not found`, 404, "NOT_FOUND");
      found.suspended = suspended;
      return mockResolve(found);
    }
    // Real suspension is an admin action on the user account.
    if (suspended) await apiClient.post(`/admin/users/${id}/suspend`, { reason: "Suspended by admin", days: 30 });
    else await apiClient.post(`/admin/users/${id}/unsuspend`);
    return this.getById(id).catch(() => ({ id, suspended } as Seller));
  },
};
