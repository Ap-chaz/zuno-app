import type { Transaction, TxStatus, Seller } from "@/types/models";

export type { Transaction, TxStatus, Seller };

export const currency = (n: number) => `KES ${n.toLocaleString()}`;

/** Seed rows predate sellerId/currency; transactions.service fills them in. */
export type SeedTransaction = Omit<Transaction, "sellerId" | "currency">;

export const transactions: SeedTransaction[] = [
  { id: "ZUNOAXFVLO4Y8Y", item: "iPhone 17 Pro Max", seller: "Gadget World", buyerName: "Brian Otieno", amount: 191311, date: "05/06/2026", status: "Funded", category: "Electronics" },
  { id: "ZUNO9KLP2M3N4Q", item: "MacBook Air M4", seller: "TechHub KE", buyerName: "Faith Wanjiru", amount: 145000, date: "04/06/2026", status: "Protected", category: "Electronics" },
  { id: "ZUNO7HG6FD5SA1", item: "Sony WH-1000XM6", seller: "AudioPro", buyerName: "Kevin Mwangi", amount: 42500, date: "03/06/2026", status: "Completed", category: "Audio" },
  { id: "ZUNO3BV5CN8XZ2", item: "Office Desk Setup", seller: "WoodCraft Co", buyerName: "Grace Achieng", amount: 88000, date: "01/06/2026", status: "Pending", category: "Furniture" },
  { id: "ZUNO1QW2ER3TY4", item: "Samsung Galaxy S25", seller: "Phone Centre", buyerName: "Daniel Kiprono", amount: 124000, date: "28/05/2026", status: "Refunded", category: "Electronics" },
  { id: "ZUNO5UI6OP7AS8", item: "Apple Watch Ultra 3", seller: "Gadget World", buyerName: "Aisha Noor", amount: 98500, date: "25/05/2026", status: "Completed", category: "Wearables" },
  { id: "ZUNO9DF8GH7JK6", item: "DJI Mini 5 Pro", seller: "Aerial KE", buyerName: "Peter Njoroge", amount: 165000, date: "20/05/2026", status: "Disputed", category: "Drones", flaggedForReview: true },
];


export const sellers: Seller[] = [
  { id: "gadget-world", name: "Gadget World", initials: "GW", rating: 4.9, reviews: 1284, category: "Electronics", verified: true, verificationTier: "verified", disputeCount: 0, deals: 3200, tagline: "Premium phones & tablets", color: "from-amber-400/30 to-orange-500/20", location: "Nairobi, Kenya", description: "Kenya's trusted destination for genuine smartphones, tablets, and accessories. Every device is sourced directly and backed by our 12-month warranty.", responseRate: 98, payoutMethod: "mpesa", payoutDetails: "Till 174829", links: { instagram: "https://instagram.com/gadgetworld", facebook: "https://facebook.com/gadgetworld", whatsapp: "https://wa.me/254700000001", website: "https://gadgetworld.co.ke" } },
  { id: "techhub-ke", name: "TechHub KE", initials: "TH", rating: 4.8, reviews: 892, category: "Computing", verified: true, verificationTier: "verified", disputeCount: 0, deals: 1850, tagline: "Laptops, accessories & repair", color: "from-violet-400/30 to-indigo-500/20", location: "Westlands, Nairobi", description: "Laptops, peripherals and certified repair services for professionals and creators.", responseRate: 96, links: { instagram: "https://instagram.com/techhubke", whatsapp: "https://wa.me/254700000002", website: "https://techhub.co.ke" } },
  { id: "audiopro", name: "AudioPro", initials: "AP", rating: 4.7, reviews: 612, category: "Audio", verified: true, verificationTier: "verified", disputeCount: 0, deals: 980, tagline: "Studio gear & headphones", color: "from-emerald-400/30 to-teal-500/20", location: "Mombasa, Kenya", description: "Premium studio monitors, headphones and DJ gear for audiophiles and producers.", responseRate: 92, payoutMethod: "bank", payoutDetails: "1122334455", payoutBankName: "KCB Bank", links: { tiktok: "https://tiktok.com/@audiopro", whatsapp: "https://wa.me/254700000003" } },
  { id: "woodcraft", name: "WoodCraft Co", initials: "WC", rating: 4.9, reviews: 421, category: "Furniture", verified: true, verificationTier: "verified", disputeCount: 0, deals: 540, tagline: "Handmade office furniture", color: "from-rose-400/30 to-pink-500/20", location: "Karen, Nairobi", description: "Bespoke, handcrafted office furniture built from sustainably sourced hardwoods.", responseRate: 99, payoutMethod: "mpesa", payoutDetails: "Paybill 400211", links: { instagram: "https://instagram.com/woodcraft", facebook: "https://facebook.com/woodcraft", website: "https://woodcraft.co.ke" } },
  { id: "aerial-ke", name: "Aerial KE", initials: "AE", rating: 4.6, reviews: 318, category: "Drones", verified: true, verificationTier: "verified", disputeCount: 0, deals: 410, tagline: "Drones & camera gear", color: "from-sky-400/30 to-blue-500/20", location: "Kilimani, Nairobi", description: "Authorized DJI reseller and aerial cinematography specialists.", responseRate: 90, payoutMethod: "bank", payoutDetails: "0998877665", payoutBankName: "Equity Bank", links: { instagram: "https://instagram.com/aerialke", tiktok: "https://tiktok.com/@aerialke", whatsapp: "https://wa.me/254700000005" } },
  { id: "phone-centre", name: "Phone Centre", initials: "PC", rating: 4.5, reviews: 2110, category: "Electronics", verified: true, verificationTier: "verified", disputeCount: 0, deals: 4200, tagline: "Phones at wholesale prices", color: "from-amber-400/30 to-yellow-500/20", location: "Moi Avenue, Nairobi", description: "Wholesale and retail smartphones at unbeatable prices, with nationwide delivery.", responseRate: 94, payoutMethod: "mpesa", payoutDetails: "Till 552210", links: { facebook: "https://facebook.com/phonecentre", whatsapp: "https://wa.me/254700000006" } },
];

export const categories = ["All", "Electronics", "Computing", "Audio", "Furniture", "Drones", "Wearables"];

export function statusColor(s: TxStatus) {
  switch (s) {
    case "Completed":
      return "bg-success/15 text-success border-success/30";
    case "Funded":
    case "Protected":
      return "bg-accent/20 text-accent border-accent/30";
    case "Pending":
      return "bg-gold/15 text-gold border-gold/30";
    case "Refunded":
      return "bg-muted text-muted-foreground border-border";
    case "Disputed":
      return "bg-destructive/15 text-destructive border-destructive/30";
  }
}

export const activeOrders = transactions.filter(
  (t) => t.status !== "Completed" && t.status !== "Refunded"
);
