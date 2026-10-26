import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Phone, Loader2, KeyRound, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { TopBar } from "@/components/zuno/TopBar";
import { PhoneFrame } from "@/components/zuno/PhoneFrame";
import { authService } from "@/services/auth.service";

export const Route = createFileRoute("/auth/forgot")({
  head: () => ({ meta: [{ title: "Reset password — ZUNO" }] }),
  component: Forgot,
});

function Forgot() {
  const [identifier, setIdentifier] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  // Signed-in users arrive from Settings > Change password, so Back returns there.
  let signedIn = false;
  try { signedIn = Boolean(localStorage.getItem("zuno_auth_token")); } catch { /* storage unavailable */ }

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim().length < 4) return toast.error("Enter the code from the SMS.");
    if (password.length < 8) return toast.error("Use a password of at least 8 characters.");
    if (password !== confirmPassword) return toast.error("The two passwords do not match.");
    setIsSubmitting(true);
    try {
      await authService.resetPassword({ phone: identifier.trim(), code: code.trim(), newPassword: password });
      toast.success("Password changed. Log in with your new password.");
      navigate({ to: "/auth/login" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't reset the password.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!identifier.trim()) {
      setError("Enter your phone number");
      return;
    }
    setIsSubmitting(true);
    try {
      await authService.requestPasswordReset(identifier);
      setSent(true);
      toast.success("Reset code sent — check your SMS.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send the reset code. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <PhoneFrame>
      <TopBar title="Forgot Password" back={signedIn ? "/app/settings" : "/auth/login"} />
      <div className="flex flex-1 flex-col px-6 pt-6">
        {sent ? (
          <form onSubmit={handleReset} noValidate className="flex flex-1 flex-col">
            <p className="text-sm leading-relaxed text-muted-foreground">
              We sent a code by SMS to <span className="font-medium text-foreground">{identifier}</span>. Enter it with a new password.
            </p>
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} placeholder="6-digit code"
              className="mt-6 h-14 rounded-2xl border border-border/60 bg-input px-4 text-sm outline-none focus:border-gold/50" />
            <label className="mt-3 flex h-14 items-center gap-3 rounded-2xl border border-border/60 bg-input px-4 focus-within:border-gold/50">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password (8+ characters)"
                autoComplete="new-password" className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
              <button type="button" onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"} className="text-muted-foreground">
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </label>
            <label className="mt-3 flex h-14 items-center gap-3 rounded-2xl border border-border/60 bg-input px-4 focus-within:border-gold/50">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              <input type={showPassword ? "text" : "password"} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm new password"
                autoComplete="new-password" className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
              <button type="button" onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"} className="text-muted-foreground">
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </label>
            <button type="submit" disabled={isSubmitting}
              className="mt-auto mb-8 flex h-14 items-center justify-center gap-2 rounded-2xl bg-gradient-gold text-base font-semibold text-gold-foreground shadow-gold disabled:opacity-60">
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Change password
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex flex-1 flex-col">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Enter your registered phone number and we'll text you a reset code.
            </p>
            <label
              className={`mt-6 flex h-14 items-center gap-3 rounded-2xl border bg-input px-4 transition-colors focus-within:border-gold/50 ${
                error ? "border-destructive/60" : "border-border/60"
              }`}
            >
              <Phone className="h-4 w-4 text-muted-foreground" />
              <input
                value={identifier}
                onChange={(e) => {
                  setIdentifier(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="Phone number e.g. 0712345678"
                aria-invalid={Boolean(error)}
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </label>
            {error && <p className="mt-1 pl-1 text-xs text-destructive">{error}</p>}

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-auto mb-8 flex h-14 items-center justify-center gap-2 rounded-2xl bg-gradient-gold text-base font-semibold text-gold-foreground shadow-gold transition-opacity disabled:opacity-60"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Send Reset Code
            </button>
          </form>
        )}
      </div>
    </PhoneFrame>
  );
}
