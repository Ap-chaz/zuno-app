import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Search, LogOut } from "lucide-react";
import { PhoneFrame } from "@/components/zuno/PhoneFrame";
import { TopBar } from "@/components/zuno/TopBar";
import { AdminGate } from "@/components/zuno/AdminGate";
import { adminLogout } from "@/lib/admin-auth";
import { useAdminTransactions } from "@/hooks/queries/useAdmin";

export const Route = createFileRoute("/admin/transactions")({
  head: () => ({ meta: [{ title: "Transaction Monitoring — ZUNO Admin" }] }),
  component: () => (
    <AdminGate>
      <AdminTransactions />
    </AdminGate>
  ),
});

const STATUSES = ["", "PENDING", "FUNDED", "IN_TRANSIT", "INSPECTION", "DISPUTED", "COMPLETED", "REFUNDED", "RESOLVED", "CANCELLED"];
const fmt = (n: number) => `Ksh ${n.toLocaleString("en-KE")}`;

// Read-only on purpose: money and status only change through the escrow flow
// (buyer approval, dispute resolution), never by editing a row here.
function AdminTransactions() {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const { data, isLoading, isError, error, refetch } = useAdminTransactions(status || undefined, q.trim() || undefined);
  return (
    <PhoneFrame>
      <TopBar title="Transaction Monitoring" back="/admin"
        right={<button type="button" onClick={() => { adminLogout(); window.location.reload(); }}
          className="grid h-10 w-10 place-items-center rounded-xl bg-surface text-muted-foreground hover:bg-surface-2" aria-label="Log out of admin">
          <LogOut className="h-4 w-4" /></button>} />
      <div className="px-5 pt-4 pb-8">
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search id, item or buyer…"
            className="h-11 w-full rounded-2xl border border-border/60 bg-input pl-9 pr-3 text-sm outline-none focus:border-gold/50" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="mb-4 h-10 w-full rounded-xl border border-border/60 bg-input px-3 text-xs">
          {STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace("_", " ") : "All statuses"}</option>)}
        </select>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {isError && (
          <div className="mb-3 rounded-xl bg-surface p-3 text-center text-xs text-destructive">
            <p>Could not load transactions: {String((error as Error)?.message ?? error)}</p>
            <button type="button" onClick={() => refetch()} className="mt-2 font-semibold underline">Try again</button>
          </div>
        )}
        <div className="space-y-2">
          {data?.map((t) => (
            <article key={t.id} className="rounded-2xl border border-border/40 bg-surface p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{t.item}</p>
                  <p className="truncate text-xs text-muted-foreground">{t.seller} → {t.buyer || "buyer"}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">{t.id}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-bold">{fmt(t.buyerPays)}</p>
                  <p className="text-[10px] text-muted-foreground">fee {fmt(t.platformFee)}</p>
                  <span className="mt-1 inline-block rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold">{t.status.replace("_", " ")}</span>
                </div>
              </div>
            </article>
          ))}
          {!isLoading && !isError && (data?.length ?? 0) === 0 && <p className="rounded-xl bg-surface p-3 text-center text-xs text-muted-foreground">No transactions.</p>}
        </div>
      </div>
    </PhoneFrame>
  );
}
