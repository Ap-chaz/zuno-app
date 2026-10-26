import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Search, Star, ChevronRight, Store } from "lucide-react";
import { TopBar } from "@/components/zuno/TopBar";
import { VerificationBadge } from "@/components/zuno/VerificationBadge";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/StateViews";
import { useSellerSearch } from "@/hooks/queries/useSellers";
import { SELLER_CATEGORIES } from "@/services/sellers.service";
import { isEligibleForDisplay } from "@/lib/seller-eligibility";

export const Route = createFileRoute("/app/sellers")({
  head: () => ({ meta: [{ title: "Verified Sellers — ZUNO" }] }),
  component: Sellers,
});

function Sellers() {
  const [cat, setCat] = useState("All");
  const [query, setQuery] = useState("");
  const { data: searchResults, isLoading, isError, refetch } = useSellerSearch(query, cat);
  const filtered = searchResults?.filter(isEligibleForDisplay);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <TopBar title="Verified Sellers" back="/app" />

      {/* Search + filters live in one header block with explicit vertical
          rhythm (space-y-3) instead of relying on each row's own margin to
          not collide with the next. */}
      <div className="space-y-3 px-4 sm:px-6 pb-3 pt-4">
        <label className="flex h-12 items-center gap-3 rounded-2xl border border-border/60 bg-input px-4 focus-within:border-gold/50">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sellers, products…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>

        {/* -mx-4 sm:-mx-6/px-4 sm:px-6 lets the row scroll edge-to-edge while the visible
            pills still line up with the page gutter; py-1 gives focus
            rings/shadows room so they don't get clipped by the scroller. */}
        <div className="-mx-4 sm:-mx-6 flex gap-2 overflow-x-auto px-4 sm:px-6 py-1 hide-scrollbar">
          {SELLER_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`flex h-8 shrink-0 items-center rounded-full border px-4 text-xs font-semibold transition-colors ${
                cat === c
                  ? "border-gold bg-gold text-gold-foreground"
                  : "border-border bg-surface text-muted-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 px-4 sm:px-6 pb-6">
        {isLoading && <ListSkeleton rows={3} />}
        {isError && <ErrorState description="Couldn't load sellers." onRetry={() => refetch()} />}
        {!isLoading && !isError && (filtered?.length ?? 0) === 0 && (
          <EmptyState icon={Store} title="No sellers found" description="Try a different search term or category." />
        )}
        {!isLoading &&
          !isError &&
          filtered?.map((s) => (
            <article
              key={s.id}
              className="flex h-auto flex-col rounded-3xl border border-border/40 bg-surface shadow-card"
            >
              {/* Banner owns its own overflow-hidden/rounded-top context.
                  The card itself never clips, so no fixed height or
                  max-height anywhere can silently cut off content below it. */}
              <div className={`h-20 shrink-0 overflow-hidden rounded-t-3xl bg-gradient-to-br ${s.color}`} />

              <div className="flex flex-1 flex-col p-4 pt-0">
                <div className="-mt-8 mb-3 grid h-16 w-16 shrink-0 place-items-center rounded-2xl border-4 border-surface bg-gradient-violet text-lg font-bold">
                  {s.initials}
                </div>

                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h3 className="truncate font-semibold">{s.name}</h3>
                      <VerificationBadge seller={s} />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{s.tagline}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="flex items-center gap-1 text-sm font-bold">
                      <Star className="h-3.5 w-3.5 fill-gold text-gold" /> {s.rating}
                    </div>
                    <p className="text-[10px] text-muted-foreground">{s.reviews} reviews</p>
                  </div>
                </div>

                {/* mt-auto pins the footer to the bottom of the card instead
                    of a fixed top offset, so "View seller", the rating, and
                    the category tag never get pushed out of a clipped box —
                    the card just grows to fit its content. */}
                <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/40 pt-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span>
                      <span className="font-bold text-foreground">{s.deals.toLocaleString()}</span>{" "}
                      <span className="text-muted-foreground">deals</span>
                    </span>
                    <span className="rounded-full bg-gold/10 px-2 py-0.5 text-[10px] font-semibold leading-4 text-gold">
                      {s.category}
                    </span>
                  </div>
                  <Link
                    to="/app/seller/$id"
                    params={{ id: s.id }}
                    className="flex shrink-0 items-center gap-1 text-xs font-semibold text-gold"
                  >
                    View seller <ChevronRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            </article>
          ))}
      </div>
    </div>
  );
}
