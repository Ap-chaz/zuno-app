import { useState } from "react";
import { Lock, Loader2 } from "lucide-react";
import { PhoneFrame } from "@/components/zuno/PhoneFrame";
import { TopBar } from "@/components/zuno/TopBar";
import { useAuth } from "@/hooks/useAuth";

/**
 * Wrap any admin page with this. Access = a signed-in account whose role is "admin",
 * as reported by the server. The API checks the role again on every admin request,
 * so there is no shared passcode and nothing secret in this bundle.
 */
export function AdminGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (user?.role === "admin") return <>{children}</>;
  return <AdminSignIn signedInAsOther={Boolean(user)} />;
}

function AdminSignIn({ signedInAsOther }: { signedInAsOther: boolean }) {
  const { login, logout } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    try {
      if (signedInAsOther) await logout();
      await login({ identifier, password });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PhoneFrame>
      <TopBar title="Admin Access" back="/" />
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <div className="grid h-16 w-16 place-items-center rounded-3xl bg-gold/15 text-gold">
          <Lock className="h-8 w-8" />
        </div>
        <h1 className="mt-4 text-lg font-bold">Admin sign-in</h1>
        <p className="mt-1 text-center text-xs text-muted-foreground">
          {signedInAsOther
            ? "This account is not an admin. Sign in with an admin account to continue."
            : "Sign in with your ZUNO admin account."}
        </p>
        <input
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder="Phone or email"
          autoComplete="username"
          className="mt-6 h-12 w-full max-w-xs rounded-2xl border border-border/60 bg-input px-4 text-sm outline-none focus:border-gold/50"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="Password"
          autoComplete="current-password"
          className="mt-3 h-12 w-full max-w-xs rounded-2xl border border-border/60 bg-input px-4 text-sm outline-none focus:border-gold/50"
        />
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={busy || !identifier || !password}
          className="mt-4 flex h-12 w-full max-w-xs items-center justify-center gap-2 rounded-2xl bg-gradient-gold text-sm font-semibold text-gold-foreground shadow-gold disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Sign in
        </button>
      </div>
    </PhoneFrame>
  );
}
