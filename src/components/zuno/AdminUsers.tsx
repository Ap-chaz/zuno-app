import { useState } from "react";
import { Search, LogOut, UserX, UserCheck, Loader2, BadgeCheck } from "lucide-react";
import { toast } from "sonner";
import { PhoneFrame } from "@/components/zuno/PhoneFrame";
import { TopBar } from "@/components/zuno/TopBar";
import { adminLogout } from "@/lib/admin-auth";
import { errorMessage } from "@/lib/api/client";
import { useAdminUsers, useSetListing, useSetTier, useSuspend, useUnsuspend } from "@/hooks/queries/useAdmin";
import type { AdminUser } from "@/services/admin.service";

export function AdminUsers({ role, title }: { role: "buyer" | "seller"; title: string }) {
  const [query, setQuery] = useState("");
  const { data: users, isLoading } = useAdminUsers(role, query.trim() || undefined);
  return (
    <PhoneFrame>
      <TopBar title={title} back="/admin"
        right={<button type="button" onClick={() => { adminLogout(); window.location.reload(); }}
          className="grid h-10 w-10 place-items-center rounded-xl bg-surface text-muted-foreground hover:bg-surface-2" aria-label="Log out of admin">
          <LogOut className="h-4 w-4" /></button>} />
      <div className="px-5 pt-4 pb-8">
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, phone, email…"
            className="h-11 w-full rounded-2xl border border-border/60 bg-input pl-9 pr-3 text-sm outline-none focus:border-gold/50" />
        </div>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        <div className="space-y-2">{users?.map((u) => <UserRow key={u.id} u={u} />)}</div>
        {!isLoading && (users?.length ?? 0) === 0 && (
          <p className="rounded-xl bg-surface p-3 text-center text-xs text-muted-foreground">No accounts found.</p>
        )}
      </div>
    </PhoneFrame>
  );
}

function UserRow({ u }: { u: AdminUser }) {
  const suspend = useSuspend();
  const unsuspend = useUnsuspend();
  const setTier = useSetTier();
  const setListing = useSetListing();
  const busy = suspend.isPending || unsuspend.isPending || setTier.isPending || setListing.isPending;
  const suspended = !u.active;
  const onErr = (e: unknown) => toast.error(errorMessage(e));

  const doSuspend = () => {
    const reason = prompt("Reason for suspension (shown to the user):");
    if (!reason || reason.trim().length < 5) return;
    const days = Number(prompt("Suspend for how many days? (1-365)", "30"));
    if (!days || days < 1 || days > 365) return toast.error("Enter 1 to 365 days.");
    suspend.mutate({ id: u.id, reason: reason.trim(), days }, { onSuccess: () => toast.success("Account suspended."), onError: onErr });
  };
  const toggleListing = () => {
    const listed = !u.verified;
    if (!confirm(listed ? `Show ${u.businessName || u.name} in the Verified Sellers directory?` : `Hide ${u.businessName || u.name} from the Verified Sellers directory?`)) return;
    setListing.mutate({ id: u.id, listed }, { onSuccess: () => toast.success(listed ? "Seller is now listed." : "Seller hidden from directory."), onError: onErr });
  };
  const doTier = () => {
    const notes = prompt("Tier 2 raises this seller's deal limit to Ksh 1,000,000. Note what you verified (e.g. business registration, KRA PIN):");
    if (!notes || notes.trim().length < 5) return;
    setTier.mutate({ id: u.id, tier: 2, notes: notes.trim() }, { onSuccess: () => toast.success("Seller upgraded to Tier 2."), onError: onErr });
  };

  return (
    <article className="rounded-2xl border border-border/40 bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1 truncate text-sm font-semibold">
            {u.businessName || u.name}
            {u.verified && <BadgeCheck className="h-3.5 w-3.5 text-gold" />}
          </p>
          <p className="truncate text-xs text-muted-foreground">{u.name} · {u.phone}</p>
          {u.email && <p className="truncate text-xs text-muted-foreground">{u.email}</p>}
        </div>
        <div className="shrink-0 text-right text-[11px] text-muted-foreground">
          {u.role === "seller" && <p>Tier {u.tier} · {u.verificationStatus.toLowerCase()}</p>}
          <p>{u.dealCount} deals · {u.disputeCount} disputes</p>
          {!u.phoneVerified && <p className="text-destructive">phone unverified</p>}
        </div>
      </div>
      {suspended && <p className="mt-2 text-xs text-destructive">Suspended: {u.suspensionReason ?? "—"}{u.suspendedUntil ? ` until ${new Date(u.suspendedUntil).toLocaleDateString("en-GB")}` : ""}</p>}
      <div className="mt-3 flex gap-2">
        {u.role === "seller" && (
          <button type="button" disabled={busy} onClick={toggleListing} className="h-9 flex-1 rounded-lg bg-gold/15 text-xs font-semibold text-gold disabled:opacity-50">
            {u.verified ? "Hide from directory" : "Verify & list"}</button>
        )}
        {u.role === "seller" && u.tier === 1 && (
          <button type="button" disabled={busy} onClick={doTier} className="h-9 flex-1 rounded-lg bg-gold/15 text-xs font-semibold text-gold disabled:opacity-50">
            Upgrade to Tier 2</button>
        )}
        {suspended ? (
          <button type="button" disabled={busy} onClick={() => unsuspend.mutate(u.id, { onSuccess: () => toast.success("Account restored."), onError: onErr })}
            className="flex h-9 flex-1 items-center justify-center gap-1 rounded-lg bg-success/15 text-xs font-semibold text-success disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />} Restore</button>
        ) : (
          <button type="button" disabled={busy} onClick={doSuspend}
            className="flex h-9 flex-1 items-center justify-center gap-1 rounded-lg bg-destructive/15 text-xs font-semibold text-destructive disabled:opacity-50">
            <UserX className="h-3.5 w-3.5" /> Suspend</button>
        )}
      </div>
    </article>
  );
}
