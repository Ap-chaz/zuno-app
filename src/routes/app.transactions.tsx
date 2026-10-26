import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, SlidersHorizontal, Inbox, Smartphone } from "lucide-react";
import { TopBar } from "@/components/zuno/TopBar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/common/StateViews";
import { useTransactions } from "@/hooks/queries/useTransactions";
import { formatCurrency, statusColorClass } from "@/services/transactions.service";
import type { TxStatus } from "@/types/models";

const filters: ("All" | TxStatus)[] = [
  "All",
  "Completed",
  "Funded",
  "Pending",
  "Protected",
  "Refunded",
  "Disputed",
];

type SortKey = "newest" | "oldest" | "amount-desc" | "amount-asc";
const SORT_LABELS: Record<SortKey, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  "amount-desc": "Amount: High to Low",
  "amount-asc": "Amount: Low to High",
};

export const Route = createFileRoute("/app/transactions")({
  head: () => ({ meta: [{ title: "Activity — ZUNO" }] }),
  component: Activity,
});

function Activity() {
  const { data: transactions, isLoading, isError, refetch } = useTransactions();
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");

  const list = useMemo(() => {
    let result = transactions ?? [];
    if (filter !== "All") result = result.filter((t) => t.status === filter);
    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (t) =>
          t.item.toLowerCase().includes(q) ||
          t.seller.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q),
      );
    }
    const sorted = [...result];
    switch (sort) {
      case "newest":
        sorted.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        break;
      case "oldest":
        sorted.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        break;
      case "amount-desc":
        sorted.sort((a, b) => b.amount - a.amount);
        break;
      case "amount-asc":
        sorted.sort((a, b) => a.amount - b.amount);
        break;
    }
    return sorted;
  }, [transactions, filter, query, sort]);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <TopBar
        title="Activity"
        back="/app"
        right={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Sort transactions"
                className="grid h-10 w-10 place-items-center rounded-xl bg-surface transition-colors hover:bg-surface-2"
              >
                <SlidersHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                  <DropdownMenuRadioItem key={key} value={key}>
                    {SORT_LABELS[key]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className="px-4 sm:px-6 pt-4">
        <label className="flex h-12 items-center gap-3 rounded-2xl border border-border/60 bg-input px-4 focus-within:border-gold/50">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search transactions"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>

      <div className="mt-4 flex shrink-0 gap-2 overflow-x-auto px-4 sm:px-6 pb-1 hide-scrollbar min-h-[38px]">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`shrink-0 rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors ${
              filter === f
                ? "border-gold bg-gold text-gold-foreground"
                : "border-border bg-surface text-muted-foreground"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="mt-4 px-4 sm:px-6 pb-6">
        {isLoading && <ListSkeleton rows={5} />}
        {isError && (
          <ErrorState description="Couldn't load your transactions." onRetry={() => refetch()} />
        )}
        {!isLoading && !isError && list.length === 0 && (
          <EmptyState
            icon={Inbox}
            title="No matching transactions"
            description={
              query || filter !== "All"
                ? "Try a different search or filter."
                : "Your escrow payments will appear here."
            }
          />
        )}
        {!isLoading && !isError && list.length > 0 && (
          <ul className="space-y-2">
            {list.map((t) => (
              <li key={t.id}>
                <Link
                  to="/app/transaction/$id"
                  params={{ id: t.id }}
                  className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-border/40 bg-surface p-3.5 transition-colors hover:border-gold/30"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-surface-2 text-muted-foreground">
                    <Smartphone className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{t.item}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {t.seller} · {t.date}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold">{formatCurrency(t.amount)}</p>
                    <span
                      className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusColorClass(t.status)}`}
                    >
                      {t.status}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
