import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { LogOut, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { PhoneFrame } from "@/components/zuno/PhoneFrame";
import { TopBar } from "@/components/zuno/TopBar";
import { AdminGate } from "@/components/zuno/AdminGate";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { adminLogout } from "@/lib/admin-auth";
import { useAdminTransactions } from "@/hooks/queries/useAdmin";
import { formatCurrency } from "@/services/transactions.service";
import type { TxStatus } from "@/types/models";

export const Route = createFileRoute("/admin/analytics")({
  head: () => ({ meta: [{ title: "Analytics — ZUNO Admin" }] }),
  component: () => (
    <AdminGate>
      <AdminAnalytics />
    </AdminGate>
  ),
});

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending", FUNDED: "Funded", IN_TRANSIT: "In transit", DELIVERED: "Inspection", INSPECTION: "Inspection",
  COMPLETED: "Completed", REFUNDED: "Refunded", RESOLVED: "Resolved", CANCELLED: "Cancelled", DISPUTED: "Disputed",
};

const volumeConfig: ChartConfig = { amount: { label: "Volume (KES)", color: "hsl(38 92% 50%)" } };
const statusConfig: ChartConfig = { count: { label: "Transactions", color: "hsl(38 92% 50%)" } };
const categoryConfig: ChartConfig = { amount: { label: "Volume (KES)", color: "hsl(38 92% 50%)" } };

function parseSeedDate(d: string): Date {
  const [day, month, year] = d.split("/").map(Number);
  return new Date(year, month - 1, day);
}

// NOTE: this is built off the current seed dataset (7 mock transactions
// spanning ~2 weeks), so the charts will look sparse until there's real
// usage volume — that's expected for pre-launch, not a bug.
function AdminAnalytics() {
  const { data: adminTx, isLoading } = useAdminTransactions();
  const transactions = useMemo(
    () =>
      adminTx?.map((t) => {
        const d = new Date(t.createdAt);
        return {
          date: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`,
          amount: t.buyerPays,
          status: (STATUS_LABEL[t.status] ?? "Pending") as TxStatus,
          category: "All deals",
          seller: t.seller,
        };
      }),
    [adminTx],
  );

  const volumeByDate = useMemo(() => {
    if (!transactions) return [];
    const map = new Map<string, number>();
    for (const t of transactions) {
      map.set(t.date, (map.get(t.date) ?? 0) + t.amount);
    }
    return [...map.entries()]
      .map(([date, amount]) => ({ date, amount, sortKey: parseSeedDate(date).getTime() }))
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(({ date, amount }) => ({ date: date.slice(0, 5), amount }));
  }, [transactions]);

  const byStatus = useMemo(() => {
    if (!transactions) return [];
    const order: TxStatus[] = ["Pending", "Funded", "Protected", "Completed", "Refunded", "Disputed"];
    const map = new Map<TxStatus, number>();
    order.forEach((s) => map.set(s, 0));
    transactions.forEach((t) => map.set(t.status, (map.get(t.status) ?? 0) + 1));
    return order.map((status) => ({ status, count: map.get(status) ?? 0 }));
  }, [transactions]);

  const byCategory = useMemo(() => {
    if (!transactions) return [];
    const map = new Map<string, number>();
    transactions.forEach((t) => map.set(t.category, (map.get(t.category) ?? 0) + t.amount));
    return [...map.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [transactions]);

  const topSellers = useMemo(() => {
    if (!transactions) return [];
    const map = new Map<string, number>();
    transactions.forEach((t) => map.set(t.seller, (map.get(t.seller) ?? 0) + t.amount));
    return [...map.entries()]
      .map(([seller, amount]) => ({ seller, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
  }, [transactions]);

  return (
    <PhoneFrame>
      <TopBar
        title="Analytics"
        back="/admin"
        right={
          <button
            type="button"
            onClick={() => {
              adminLogout();
              window.location.reload();
            }}
            className="grid h-10 w-10 place-items-center rounded-xl bg-surface text-muted-foreground hover:bg-surface-2"
            aria-label="Log out of admin"
          >
            <LogOut className="h-4 w-4" />
          </button>
        }
      />

      <div className="px-5 pt-4 pb-8">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {!isLoading && (
          <>
            <SectionTitle label="Transaction volume over time" />
            <div className="mb-6 rounded-2xl border border-border/40 bg-surface p-3">
              <ChartContainer config={volumeConfig} className="aspect-[16/10]">
                <LineChart data={volumeByDate} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} width={40} />
                  <ChartTooltip content={<ChartTooltipContent formatter={(v: any) => formatCurrency(Number(v))} />} />
                  <Line type="monotone" dataKey="amount" stroke="var(--color-amount)" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ChartContainer>
            </div>

            <SectionTitle label="Transactions by status" />
            <div className="mb-6 rounded-2xl border border-border/40 bg-surface p-3">
              <ChartContainer config={statusConfig} className="aspect-[16/10]">
                <BarChart data={byStatus} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="status" tickLine={false} axisLine={false} fontSize={10} interval={0} angle={-20} textAnchor="end" height={40} />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} width={28} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" fill="var(--color-count)" radius={4} />
                </BarChart>
              </ChartContainer>
            </div>

            <SectionTitle label="Volume by category" />
            <div className="mb-6 rounded-2xl border border-border/40 bg-surface p-3">
              <ChartContainer config={categoryConfig} className="aspect-[16/10]">
                <BarChart data={byCategory} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="category" tickLine={false} axisLine={false} fontSize={10} interval={0} angle={-20} textAnchor="end" height={40} />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} width={40} />
                  <ChartTooltip content={<ChartTooltipContent formatter={(v: any) => formatCurrency(Number(v))} />} />
                  <Bar dataKey="amount" fill="var(--color-amount)" radius={4} />
                </BarChart>
              </ChartContainer>
            </div>

            <SectionTitle label="Top sellers by volume" />
            <div className="space-y-2">
              {topSellers.map((s, i) => (
                <div key={s.seller} className="flex items-center justify-between rounded-xl border border-border/40 bg-surface p-3">
                  <div className="flex items-center gap-2">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gold/10 text-[11px] font-bold text-gold">
                      {i + 1}
                    </span>
                    <span className="text-sm font-medium">{s.seller}</span>
                  </div>
                  <span className="flex items-center gap-1 text-sm font-semibold">
                    <TrendingUp className="h-3.5 w-3.5 text-success" /> {formatCurrency(s.amount)}
                  </span>
                </div>
              ))}
              {topSellers.length === 0 && (
                <p className="rounded-xl bg-surface p-3 text-center text-xs text-muted-foreground">No data yet.</p>
              )}
            </div>
          </>
        )}
      </div>
    </PhoneFrame>
  );
}

function SectionTitle({ label }: { label: string }) {
  return <p className="mb-2 text-xs font-bold tracking-[0.18em] text-muted-foreground">{label.toUpperCase()}</p>;
}
