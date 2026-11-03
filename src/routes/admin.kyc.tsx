import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { LogOut, Check, X, Loader2, CheckCircle2, ShieldCheck, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { PhoneFrame } from "@/components/zuno/PhoneFrame";
import { TopBar } from "@/components/zuno/TopBar";
import { ThemeToggle } from "@/components/zuno/ThemeToggle";
import { adminLogout } from "@/lib/admin-auth";
import { errorMessage } from "@/lib/api/client";
import { useAdminKyc, useReviewKyc } from "@/hooks/queries/useAdmin";
import type { AdminKycItem } from "@/services/admin.service";

export const Route = createFileRoute("/admin/kyc")({
  head: () => ({ meta: [{ title: "KYC & Compliance Queue — ZUNO Admin" }] }),
  component: AdminKyc,
});

function AdminKyc() {
  const { data: queue, isLoading, isError, error, refetch } = useAdminKyc();

  return (
    <PhoneFrame>
      <TopBar
        title="KYC & Compliance"
        back="/admin"
        right={
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => {
                adminLogout();
                window.location.reload();
              }}
              className="grid h-10 w-10 place-items-center rounded-xl bg-surface text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
              aria-label="Log out of admin"
              title="Sign out of Admin"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        }
      />

      <div className="px-5 pt-4 pb-12">
        <div className="mb-4">
          <h1 className="text-base font-bold text-foreground">Seller Verification Queue</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Verify national identity documents and selfies against registration records. Approving
            upgrades the merchant to Tier 1 (up to KES 50,000 per deal).
          </p>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-gold" /> Loading verification queue…
          </div>
        )}

        {isError && (
          <div className="mb-4 rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-center text-xs text-destructive">
            <p>Could not load KYC submissions: {String((error as Error)?.message ?? error)}</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-2 font-semibold underline hover:opacity-80"
            >
              Try again
            </button>
          </div>
        )}

        {!isLoading && !isError && (queue?.length ?? 0) === 0 && (
          <div className="rounded-3xl border border-border/40 bg-surface p-8 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-success" />
            <h2 className="mt-3 text-sm font-semibold">Queue is clear</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              All seller identity and business documents have been verified.
            </p>
          </div>
        )}

        {/* Responsive Grid: 1 column on phone, 2 columns on desktop */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {queue?.map((k) => (
            <KycCard key={k.id} item={k} />
          ))}
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
    if (decision === "REJECTED" && reason.trim().length < 10) {
      return toast.error("Provide a rejection explanation for the seller (at least 10 characters).");
    }
    review.mutate(
      {
        id: k.id,
        decision,
        notes: decision === "APPROVED" ? "Documents verified by mediator." : reason.trim(),
        reason: reason.trim(),
      },
      {
        onSuccess: () => {
          toast.success(
            decision === "APPROVED"
              ? `Approved ${k.fullName} (Tier 1 Verified).`
              : `Rejected ${k.fullName}. Seller notified to resubmit.`,
          );
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  const img = (label: string, url?: string) =>
    url ? (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="group relative block overflow-hidden rounded-xl border border-border/40 bg-surface-2 transition-all hover:border-gold/50"
      >
        <img
          src={url}
          alt={label}
          className="h-28 w-full object-cover transition-transform group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-black/20 opacity-0 transition-opacity group-hover:opacity-100 flex items-center justify-center">
          <ExternalLink className="h-4 w-4 text-white" />
        </div>
        <span className="block px-2 py-1 text-center text-[10px] font-semibold text-muted-foreground">
          {label}
        </span>
      </a>
    ) : (
      <div className="grid h-28 place-items-center rounded-xl border border-dashed border-border/60 bg-surface-2 text-[10px] text-muted-foreground">
        No {label}
      </div>
    );

  return (
    <article className="flex flex-col justify-between rounded-2xl border border-border/60 bg-surface p-4 shadow-sm transition-all hover:border-gold/30">
      <div>
        <div className="flex items-start justify-between gap-2 border-b border-border/40 pb-3">
          <div>
            <p className="text-sm font-bold text-foreground">{k.fullName}</p>
            <p className="text-xs text-muted-foreground">
              {k.phone}
              {k.email ? ` · ${k.email}` : ""}
            </p>
          </div>
          <span className="rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold text-gold">
            Pending Review
          </span>
        </div>

        {/* Identity & Business Info */}
        <div className="mt-3 space-y-1.5 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">National ID:</span>
            <span className="font-mono text-muted-foreground">{k.nationalId}</span>
            {k.dob && <span className="text-muted-foreground">· DOB: {k.dob}</span>}
          </div>

          {k.businessName && (
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">Business:</span>
              <span className="text-foreground">{k.businessName}</span>
              {k.businessType && (
                <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {k.businessType}
                </span>
              )}
            </div>
          )}

          {k.kraPin && (
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">KRA PIN:</span>
              <span className="font-mono text-muted-foreground">{k.kraPin}</span>
            </div>
          )}
        </div>

        {/* Verification Thumbnails */}
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Submitted Credentials
          </p>
          <div className="grid grid-cols-3 gap-2">
            {img("ID Front", k.idFrontUrl)}
            {img("ID Back", k.idBackUrl)}
            {img("Selfie Photo", k.selfieUrl)}
          </div>
        </div>

        {/* Rejection Note Field */}
        {rejecting && (
          <div className="mt-3">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Reason for rejection (e.g. ID front blurry, expired document, KRA PIN mismatch)…"
              className="w-full rounded-xl border border-border/60 bg-input p-2.5 text-xs outline-none focus:border-gold/50"
            />
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="mt-4 pt-3 border-t border-border/40">
        <div className="flex gap-2">
          {!rejecting ? (
            <>
              <button
                type="button"
                disabled={review.isPending}
                onClick={() => submit("APPROVED")}
                className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-success/15 text-xs font-semibold text-success transition-colors hover:bg-success/25 disabled:opacity-50"
              >
                {review.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                Approve (Tier 1)
              </button>
              <button
                type="button"
                disabled={review.isPending}
                onClick={() => setRejecting(true)}
                className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-destructive/15 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/25 disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" /> Reject
              </button>
            </>
          ) : (
            <div className="flex w-full gap-2">
              <button
                type="button"
                disabled={review.isPending}
                onClick={() => submit("REJECTED")}
                className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-destructive text-xs font-semibold text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {review.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )}
                Confirm Reject
              </button>
              <button
                type="button"
                onClick={() => {
                  setRejecting(false);
                  setReason("");
                }}
                className="h-10 rounded-xl border border-border/60 bg-surface px-4 text-xs font-semibold text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
