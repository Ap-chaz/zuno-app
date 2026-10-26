import { useState } from "react";
import { createFileRoute, Link, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Mail, Lock, Eye, EyeOff, Fingerprint, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { TopBar } from "@/components/zuno/TopBar";
import { PhoneFrame } from "@/components/zuno/PhoneFrame";
import { homeFor } from "@/lib/zuno-role";
import { ApiError } from "@/lib/api/client";
import { authService } from "@/services/auth.service";
import { useAuth } from "@/hooks/useAuth";
import { hasRegisteredBiometric, verifyBiometric } from "@/lib/webauthn";

type LoginSearch = { redirect?: string };

const loginSchema = z.object({
  identifier: z.string().trim().min(3, "Enter your phone number or email"),
  password: z.string().min(1, "Enter your password"),
});
type LoginForm = z.infer<typeof loginSchema>;

export const Route = createFileRoute("/auth/login")({
  head: () => ({ meta: [{ title: "Log in — ZUNO" }] }),
  validateSearch: (s: Record<string, unknown>): LoginSearch => ({
    redirect: typeof s.redirect === "string" ? s.redirect : undefined,
  }),
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const router = useRouter();
  const { redirect } = useSearch({ from: "/auth/login" });
  const { login, restoreSession } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [isVerifyingBiometric, setIsVerifyingBiometric] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: "", password: "" },
  });

  const routeAfterLogin = () => {
    // Read the role the server just gave us (state may not have re-rendered yet).
    const role = authService.getStoredSession()?.user.role;
    // Only same-site paths ("/x"), never "//host" or full URLs.
    if (redirect && redirect.startsWith("/") && !redirect.startsWith("//") && role !== "admin") {
      router.history.push(redirect);
      return;
    }
    navigate({ to: homeFor(role) });
  };

  const onSubmit = async (values: LoginForm) => {
    try {
      await login({ identifier: values.identifier, password: values.password });
      routeAfterLogin();
    } catch (err) {
      if (err instanceof ApiError && err.code === "PHONE_NOT_VERIFIED") {
        // The API just texted a fresh code to the number on this account.
        authService.setPendingPhone((err.data?.phone as string | undefined) ?? (values.identifier.includes("@") ? null : values.identifier.trim()));
        toast.info("Verify your phone number to continue.");
        navigate({ to: "/auth/verify" });
        return;
      }
      toast.error(err instanceof Error ? err.message : "Couldn't log in. Check your details and try again.");
    }
  };

  const handleBiometrics = async () => {
    if (!hasRegisteredBiometric()) {
      toast.info("Set up biometric login from Settings after you log in with your password first.");
      return;
    }
    setIsVerifyingBiometric(true);
    try {
      const verified = await verifyBiometric();
      if (!verified) {
        toast.error("Biometric verification was cancelled.");
        return;
      }
      const restored = restoreSession();
      if (!restored) {
        toast.error("No saved session on this device — please log in with your password.");
        return;
      }
      routeAfterLogin();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Biometric verification failed.");
    } finally {
      setIsVerifyingBiometric(false);
    }
  };

  return (
    <PhoneFrame>
      <TopBar title="Log In" back="/" />
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-1 flex-col px-6 pt-6">
        {redirect && (
          <div className="mb-4 rounded-2xl border border-gold/30 bg-gold/5 p-3 text-xs text-muted-foreground">
            Log in with your <span className="font-semibold text-foreground">Buyer account</span> to continue creating the Protected Deal.
          </div>
        )}
        <Field icon={Mail} placeholder="Phone Number or Email" autoComplete="username" error={errors.identifier?.message} {...register("identifier")} />
        <div className="h-4" />
        <Field
          icon={Lock}
          placeholder="Password"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          error={errors.password?.message}
          trailing={
            <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"} className="text-muted-foreground">
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          }
          {...register("password")}
        />
        <Link to="/auth/forgot" className="mt-3 self-end text-xs font-medium text-gold">
          Forgot Password?
        </Link>

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-8 flex h-14 items-center justify-center gap-2 rounded-2xl bg-gradient-gold text-base font-semibold text-gold-foreground shadow-gold transition-opacity disabled:opacity-60"
        >
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Log In
        </button>

        <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
        </div>

        <button
          type="button"
          onClick={handleBiometrics}
          disabled={isVerifyingBiometric}
          className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-border bg-surface/60 text-base font-semibold transition-colors hover:bg-surface-2 disabled:opacity-60"
        >
          {isVerifyingBiometric ? <Loader2 className="h-5 w-5 animate-spin text-gold" /> : <Fingerprint className="h-5 w-5 text-gold" />}
          Continue with Biometrics
        </button>

        <p className="mt-auto pb-8 pt-10 text-center text-sm text-muted-foreground">
          Don't have an account?{" "}
          <Link to="/auth/signup" className="font-semibold text-gold">
            Sign up
          </Link>
        </p>
      </form>
    </PhoneFrame>
  );
}

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon: typeof Mail;
  trailing?: React.ReactNode;
  error?: string;
}

const Field = ({ icon: Icon, trailing, error, ...inputProps }: FieldProps) => {
  return (
    <div>
      <label
        className={`flex h-14 items-center gap-3 rounded-2xl border bg-input px-4 transition-colors focus-within:border-gold/50 ${
          error ? "border-destructive/60" : "border-border/60"
        }`}
      >
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input {...inputProps} aria-invalid={Boolean(error)} className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
        {trailing}
      </label>
      {error && <p className="mt-1 pl-1 text-xs text-destructive">{error}</p>}
    </div>
  );
};
