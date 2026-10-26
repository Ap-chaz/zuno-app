import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { LogOut, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PhoneFrame } from "@/components/zuno/PhoneFrame";
import { TopBar } from "@/components/zuno/TopBar";
import { AdminGate } from "@/components/zuno/AdminGate";
import { adminLogout } from "@/lib/admin-auth";
import { errorMessage } from "@/lib/api/client";
import { useAdminKyc, useReviewKyc } from "@/hooks/queries/useAdmin";
import type { AdminKycItem } from "@/services/admin.service";

export const Route = createFileRoute("/admin/kyc")({
  head: () => ({ meta: [{ title: "KYC & Compliance — ZUNO Admin" }] }),
  component: () => (
    <AdminGate>
      <AdminKyc />
    </AdminGate>
  ),
});

function AdminKyc() {
  const { data: queue, isLoading } = useAdminKyc();
  return (
    <PhoneFrame>
      <TopBar title="KYC & Compliance" back="/admin"
        right={<button type="button" onClick={() => { adminLogout(); window.location.reload(); }}
          className="grid h-10 w-10 place-items-center rounded-xl bg-surface text-muted-foreground hover:bg-surface-2" aria-label="Log out of admin">
          <LogOut className="h-4 w-4" /></button>} />
      <div className="px-5 pt-4 pb-8">
        <p className="mb-4 text-xs text-muted-foreground">
          Compare the ID photos and selfie with the details entered. Approving makes the seller Tier 1. Rejected sellers can resubmit.
        </p>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        <div className="space-y-3">
          {queue?.map((k) => <KycCard key={k.id} item={k} />)}
          {!isLoading && (queue?.length ?? 0) === 0 && (
            <p className="rounded-xl bg-surface p-3 text-center text-xs text-muted-foreground">Nothing pending review.</p>
          )}
        </div>
      </div>
    </PhoneFrame>
  );
}

function KycCard({ item: k }: { item: AdminKycItem }) {
  const review = useReviewKyc();
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  const submit = (decision: "APPROVED" | "REJECTED") => {
    if (decision === "REJECTED" && reason.trim().length < 10) return toast.error("Tell the seller what to fix (at least 10 characters).");
    review.mutate(
      { id: k.id, decision, notes: decision === "APPROVED" ? "Documents verified." : reason.trim(), reason: reason.trim() },
      {
        onSuccess: () => toast.success(decision === "APPROVED" ? "Seller approved." : "Submission rejected."),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  const img = (label: string, url?: string) => url ? (
    <a href={url} target="_blank" rel="noreferrer" className="block">
      <img src={url} alt={label} className="h-24 w-full rounded-lg object-cover" loading="lazy" />
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </a>
  ) : <div className="grid h-24 place-items-center rounded-lg bg-surface-2 text-[10px] text-muted-foreground">No {label}</div>;

  return (
    <article className="rounded-2xl border border-border/40 bg-surface p-3">
      <p className="text-sm font-semibold">{k.fullName}</p>
      <p className="text-xs text-muted-foreground">{k.phone}{k.email ? ` · ${k.email}` : ""}</p>
      <p className="mt-1 text-xs">ID {k.nationalId}{k.dob ? ` · DOB ${k.dob}` : ""}</p>
      {k.businessName && <p className="text-xs">{k.businessName}{k.businessType ? ` (${k.businessType})` : ""}{k.kraPin ? ` · KRA ${k.kraPin}` : ""}</p>}
      <div className="mt-3 grid grid-cols-3 gap-2">{img("ID front", k.idFrontUrl)}{img("ID back", k.idBackUrl)}{img("Selfie", k.selfieUrl)}</div>
      {rejecting && (
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="What should the seller fix? (shown to them)"
          className="mt-3 w-full rounded-xl border border-border/60 bg-input p-2 text-xs outline-none focus:border-gold/50" />
      )}
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={review.isPending} onClick={() => submit("APPROVED")}
          className="flex h-9 flex-1 items-center justify-center gap-1 rounded-lg bg-success/15 text-xs font-semibold text-success disabled:opacity-50">
          {review.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Approve
        </button>
        <button type="button" disabled={review.isPending} onClick={() => (rejecting ? submit("REJECTED") : setRejecting(true))}
          className="flex h-9 flex-1 items-center justify-center gap-1 rounded-lg bg-destructive/15 text-xs font-semibold text-destructive disabled:opacity-50">
          <X className="h-3.5 w-3.5" /> {rejecting ? "Confirm reject" : "Reject"}
        </button>
      </div>
    </article>
  );
}
