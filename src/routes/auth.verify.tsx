import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { TopBar } from "@/components/zuno/TopBar";
import { PhoneFrame } from "@/components/zuno/PhoneFrame";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { homeFor } from "@/lib/zuno-role";
import { useAuth } from "@/hooks/useAuth";
import { authService } from "@/services/auth.service";

const RESEND_SECONDS = 45;
const OTP_LENGTH = 6;

export const Route = createFileRoute("/auth/verify")({
  head: () => ({ meta: [{ title: "Verify — ZUNO" }] }),
  component: Verify,
});

function Verify() {
  const navigate = useNavigate();
  const { verifyOtp, resendOtp } = useAuth();
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setPhone(authService.getPendingPhone());
  }, []);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const handleResend = async () => {
    if (secondsLeft > 0) return;
    try {
      await resendOtp();
      setSecondsLeft(RESEND_SECONDS);
      toast.success("A new code has been sent.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send a new code.");
    }
  };

  const handleVerify = async () => {
    if (code.length !== OTP_LENGTH) {
      setError(`Enter the full ${OTP_LENGTH}-digit code`);
      return;
    }
    setError(null);
    setIsVerifying(true);
    let verifiedUser;
    try {
      verifiedUser = await verifyOtp(code);
    } catch (err) {
      setIsVerifying(false);
      setCode("");
      setError(err instanceof Error ? err.message : "That code didn't work. Try again.");
      return;
    }
    setIsVerifying(false);

    let pendingRedirect: string | null = null;
    try {
      pendingRedirect = sessionStorage.getItem("zuno_post_auth_redirect");
      if (pendingRedirect) sessionStorage.removeItem("zuno_post_auth_redirect");
    } catch {
      // sessionStorage unavailable — fall through to role-based redirect.
    }
    if (pendingRedirect) {
      navigate({ to: pendingRedirect });
      return;
    }
    navigate({ to: homeFor(verifiedUser.role) });
  };

  return (
    <PhoneFrame>
      <TopBar title="Verify" back="/auth/signup" />
      <div
        className="flex flex-1 flex-col justify-between px-6"
        style={{ paddingTop: "clamp(16px, 4vh, 32px)", paddingBottom: "clamp(16px, 4vh, 32px)", gap: "clamp(16px, 3vh, 28px)" }}
      >
        <div style={{ gap: "clamp(12px, 2vh, 20px)" }} className="flex flex-col">
          <p className="text-xs font-bold tracking-[0.2em] text-accent">OTP VERIFICATION</p>
          <div>
            <p className="text-sm text-muted-foreground">Enter the 6-digit code sent to</p>
            <p className="mt-1 text-base font-semibold">{phone ?? "your phone"}</p>
          </div>

          <InputOTP
            maxLength={OTP_LENGTH}
            value={code}
            onChange={(value) => {
              setCode(value);
              if (error) setError(null);
            }}
            containerClassName="justify-between"
          >
            <InputOTPGroup className="w-full justify-between gap-2">
              {Array.from({ length: OTP_LENGTH }).map((_, i) => (
                <InputOTPSlot
                  key={i}
                  index={i}
                  className="h-[clamp(48px,8vh,56px)] flex-1 rounded-2xl border border-border bg-surface text-xl font-semibold ring-gold/40"
                />
              ))}
            </InputOTPGroup>
          </InputOTP>
          {error && <p className="text-center text-xs text-destructive">{error}</p>}

          <p className="text-center text-sm text-muted-foreground">
            {secondsLeft > 0 ? (
              <>
                Resend code in <span className="font-semibold text-gold">00:{secondsLeft.toString().padStart(2, "0")}</span>
              </>
            ) : (
              <button type="button" onClick={handleResend} className="font-semibold text-gold underline-offset-2 hover:underline">
                Resend code
              </button>
            )}
          </p>
        </div>

        <button
          onClick={handleVerify}
          disabled={isVerifying}
          className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-gold text-base font-semibold text-gold-foreground shadow-gold transition-opacity disabled:opacity-60"
          style={{ height: "clamp(52px, 7vh, 56px)" }}
        >
          {isVerifying && <Loader2 className="h-4 w-4 animate-spin" />}
          Verify
        </button>
      </div>
    </PhoneFrame>
  );
}
