import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { ShieldCheck, Clock, AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { isKycVerified, getKycStatus, setKycIntent } from "@/lib/zuno-kyc";

/**
 * Wrap any transaction surface (create deal, pay, release, confirm, etc.).
 * If KYC is not verified, blocks rendering with a status-aware modal:
 * - Pending: explains that documents are under review and provides link to status
 * - Rejected: prompts to resubmit
 * - Unverified: prompts to start verification
 */
export function KycGate({
  children,
  fallback = "/app",
}: {
  children: ReactNode;
  fallback?: string;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [verified, setVerified] = useState(true);
  const [status, setStatus] = useState<string>("unverified");

  useEffect(() => {
    const ok = isKycVerified();
    setVerified(ok);
    setStatus(getKycStatus());
    setReady(true);
  }, []);

  const handleVerify = () => {
    const intent =
      typeof window !== "undefined" ? window.location.pathname + window.location.search : fallback;
    setKycIntent(intent);
    navigate({ to: "/auth/kyc", search: { redirect: intent } as never });
  };

  const handleCancel = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.history.back();
    } else {
      navigate({ to: fallback as never });
    }
  };

  if (!ready) return null;
  if (verified) return <>{children}</>;

  if (status === "pending") {
    return (
      <AlertDialog open>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <div className="mx-auto mb-2 grid h-14 w-14 place-items-center rounded-2xl bg-gold/15 text-gold sm:mx-0">
              <Clock className="h-7 w-7" />
            </div>
            <AlertDialogTitle className="text-xl">Verification In Review</AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed">
              You have already submitted your identity documents (KYC). Our team is currently
              reviewing your submission — this usually takes under 24 hours.
              <br />
              <br />
              We will notify you via SMS as soon as your account is approved. Transactions will be
              unlocked immediately after approval.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancel}>Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => navigate({ to: "/app/verification" as never })}
              className="bg-gradient-gold text-gold-foreground shadow-gold hover:opacity-90"
            >
              View Status
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (status === "rejected") {
    return (
      <AlertDialog open>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <div className="mx-auto mb-2 grid h-14 w-14 place-items-center rounded-2xl bg-destructive/15 text-destructive sm:mx-0">
              <AlertTriangle className="h-7 w-7" />
            </div>
            <AlertDialogTitle className="text-xl">Verification Needs Attention</AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed">
              Your previous identity submission was not approved. Please review the feedback in the
              Verification Center and resubmit your documents to unlock transactions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancel}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleVerify}
              className="bg-gradient-gold text-gold-foreground shadow-gold hover:opacity-90"
            >
              Resubmit Documents
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <AlertDialog open>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="mx-auto mb-2 grid h-14 w-14 place-items-center rounded-2xl bg-gold/15 text-gold sm:mx-0">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <AlertDialogTitle className="text-xl">Verify Your Identity</AlertDialogTitle>
          <AlertDialogDescription className="text-sm leading-relaxed">
            To protect all users and comply with our security standards, identity verification
            (KYC) is required before you can perform transactions on ZUNO.
            <br />
            <br />
            Complete your KYC once to unlock all transaction features.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleVerify}
            className="bg-gradient-gold text-gold-foreground shadow-gold hover:opacity-90"
          >
            Verify Now
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
