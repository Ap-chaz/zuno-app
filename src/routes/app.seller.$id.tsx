import { createFileRoute, Link } from "@tanstack/react-router";
import { VerificationBadge } from "@/components/zuno/VerificationBadge";
import {
  Star,
  MapPin,
  Tag,
  ShieldCheck,
  TrendingUp,
  MessageCircle,
  Instagram,
  Facebook,
  Globe,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { TopBar } from "@/components/zuno/TopBar";
import { CardSkeleton, ErrorState } from "@/components/common/StateViews";
import { useSeller } from "@/hooks/queries/useSellers";

export const Route = createFileRoute("/app/seller/$id")({
  head: () => ({ meta: [{ title: "Seller Profile — ZUNO" }] }),
  component: SellerProfile,
});

// TikTok isn't in lucide; use a small inline glyph.
function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M19.5 8.6a6.6 6.6 0 0 1-3.9-1.3v7.4a5.3 5.3 0 1 1-5.3-5.3c.3 0 .6 0 .9.1v2.6a2.7 2.7 0 1 0 1.9 2.6V2h2.5a4 4 0 0 0 3.9 3.9V8.6z" />
    </svg>
  );
}

function SellerProfile() {
  const { id } = Route.useParams();
  const { data: seller, isLoading, isError, refetch } = useSeller(id);

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col overflow-y-auto pb-8">
        <TopBar title="Seller Profile" back="/app/sellers" />
        <div className="space-y-4 px-4 sm:px-6 pt-4">
          <CardSkeleton className="h-36" />
          <CardSkeleton className="h-24" />
          <CardSkeleton className="h-40" />
        </div>
      </div>
    );
  }

  if (isError || !seller) {
    return (
      <div className="flex flex-1 flex-col overflow-y-auto pb-8">
        <TopBar title="Seller Profile" back="/app/sellers" />
        <div className="px-4 sm:px-6 pt-6">
          <ErrorState title="Seller not found" description="This profile may have moved or doesn't exist." onRetry={() => refetch()} />
          <Link to="/app/sellers" className="mt-4 block text-center text-sm font-semibold text-gold">
            Back to verified sellers
          </Link>
        </div>
      </div>
    );
  }

  const links = seller.links ?? {};
  const linkItems = [
    links.instagram && { key: "instagram", label: "Instagram", url: links.instagram, icon: Instagram },
    links.facebook && { key: "facebook", label: "Facebook", url: links.facebook, icon: Facebook },
    links.tiktok && { key: "tiktok", label: "TikTok", url: links.tiktok, icon: TikTokIcon },
    links.whatsapp && { key: "whatsapp", label: "WhatsApp", url: links.whatsapp, icon: MessageCircle },
    links.website && { key: "website", label: "Website", url: links.website, icon: Globe },
  ].filter(Boolean) as Array<{ key: string; label: string; url: string; icon: typeof Instagram }>;

  // If the count is odd, the trailing item spans both columns instead of
  // floating alone on one side of the grid.
  const lastIsOrphan = linkItems.length % 2 === 1;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <TopBar title="Seller Profile" back="/app/sellers" />

      {/* Cover + logo share one relative wrapper so the avatar's overlap is
          always relative to the banner's own box, never to the page — same
          pattern as the list card, just at profile scale. */}
      <div className="relative">
        <div className={`h-32 overflow-hidden bg-gradient-to-br ${seller.color}`}>
          <div className="h-full w-full bg-gradient-to-t from-background/80 to-transparent" />
        </div>
        <div className="absolute -bottom-10 left-5 grid h-20 w-20 place-items-center rounded-3xl border-4 border-background bg-gradient-violet text-2xl font-bold shadow-card">
          {seller.initials}
        </div>
      </div>

      {/* Identity — pt-12 clears the avatar that now overlaps via absolute
          positioning instead of a negative margin fighting the flow. */}
      <div className="px-4 sm:px-6 pt-12">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="truncate text-xl font-bold">{seller.name}</h1>
              <VerificationBadge seller={seller} className="h-5 w-5 shrink-0" />
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">{seller.tagline}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {seller.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 text-gold" aria-hidden="true" /> {seller.location}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <Tag className="h-3.5 w-3.5 text-gold" aria-hidden="true" /> {seller.category}
              </span>
            </div>
          </div>
          <button
            onClick={() => toast.info("In-app messaging is coming soon — try WhatsApp below if available.")}
            aria-label={`Message ${seller.name}`}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-border/60 bg-surface text-gold transition-colors hover:bg-surface-2"
          >
            <MessageCircle className="h-4 w-4" />
          </button>
        </div>

        {seller.description && (
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{seller.description}</p>
        )}
      </div>

      {/* Trust statistics */}
      <section className="mt-5 px-4 sm:px-6">
        <p className="text-[11px] font-bold tracking-[0.18em] text-muted-foreground">TRUST STATISTICS</p>
        <div className="mt-3 grid grid-cols-3 gap-2.5">
          <Stat icon={Star} value={seller.rating.toFixed(1)} label="Rating" sub={`${seller.reviews} reviews`} />
          <Stat icon={TrendingUp} value={seller.deals.toLocaleString()} label="Total Deals" sub="Completed" />
          <Stat icon={ShieldCheck} value={`${seller.responseRate ?? 95}%`} label="Response Rate" sub="Last 30d" />
        </div>
      </section>

      {/* Business links — CSS grid, 2 columns, trailing odd item spans full
          width so links never float unevenly regardless of count. */}
      {linkItems.length > 0 && (
        <section className="mt-6 px-4 sm:px-6">
          <p className="text-[11px] font-bold tracking-[0.18em] text-muted-foreground">BUSINESS LINKS</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {linkItems.map((l, i) => {
              const isOrphan = lastIsOrphan && i === linkItems.length - 1;
              return (
                <a
                  key={l.key}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${seller.name} on ${l.label} (opens in a new tab)`}
                  className={`flex items-center gap-2.5 rounded-2xl border border-border/60 bg-surface px-3 py-2.5 text-sm font-semibold transition-colors hover:border-gold/60 ${
                    isOrphan ? "col-span-2" : ""
                  }`}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gold/10 text-gold">
                    <l.icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  {l.label}
                </a>
              );
            })}
          </div>
        </section>
      )}

      {/* Escrow notice */}
      <div className="mx-5 mt-6 flex items-start gap-2 rounded-2xl border border-border/40 bg-surface/60 p-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
        <span>Every transaction with {seller.name} is protected by ZUNO escrow. Funds are only released after delivery confirmation.</span>
      </div>

      {/* Sticky CTA — `sticky`, not `fixed`: it needs to pin to the bottom of
          this page's own scroll pane (and therefore the content column's
          actual width), not the raw browser viewport. `fixed` ignored the
          sidebar entirely and centered on the whole window instead. */}
      <div className="sticky bottom-0 z-10 border-t border-border/40 bg-background/95 px-4 sm:px-6 py-3 backdrop-blur">
        <Link
          to="/app/new-escrow"
          search={{ seller: String(seller?.id ?? "") } as never}
          className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-gradient-gold text-base font-semibold text-gold-foreground shadow-gold transition-opacity hover:opacity-95"
        >
          Start Secure Transaction <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  value,
  label,
  sub,
}: {
  icon: typeof Star;
  value: string;
  label: string;
  sub: string;
}) {
  return (
    <div className="rounded-2xl border border-border/40 bg-surface p-4">
      <Icon className="h-4 w-4 text-gold" aria-hidden="true" />
      <p className="mt-2 text-lg font-bold leading-none">{value}</p>
      <p className="mt-1 text-[11px] font-semibold">{label}</p>
      <p className="text-[10px] text-muted-foreground">{sub}</p>
    </div>
  );
}
