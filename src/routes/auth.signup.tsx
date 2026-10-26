import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Mail, Lock, Eye, EyeOff, Phone, User, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { TopBar } from "@/components/zuno/TopBar";
import { PhoneFrame } from "@/components/zuno/PhoneFrame";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/hooks/useAuth";
import type { ZunoRole } from "@/types/models";

const signupSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name"),
  phone: z
    .string()
    .trim()
    .min(9, "Enter a valid phone number")
    .regex(/^[+0-9\s-]+$/, "Digits only, please"),
  email: z.string().trim().email("Enter a valid email address").or(z.literal("")),
  password: z.string().min(8, "Use at least 8 characters"),
  agree: z.literal(true, {
    errorMap: () => ({ message: "You must accept the Terms and Privacy Policy" }),
  }),
});

type SignupForm = z.infer<typeof signupSchema>;

export const Route = createFileRoute("/auth/signup")({
  head: () => ({ meta: [{ title: "Sign up — ZUNO" }] }),
  component: Signup,
});

function Signup() {
  const navigate = useNavigate();
  const { signup } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<Exclude<ZunoRole, "admin">>("buyer");
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SignupForm>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: "", phone: "", email: "", password: "" },
  });
  const agree = watch("agree");

  const onSubmit = async (values: SignupForm) => {
    try {
      await signup({ name: values.name, email: values.email, phone: values.phone, password: values.password, role });
      navigate({ to: "/auth/verify" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create your account. Try again.");
    }
  };

  return (
    <PhoneFrame>
      <TopBar title="Sign Up" back="/" />
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-1 flex-col gap-3 px-6 pt-6">
        <p className="text-xs font-bold tracking-[0.2em] text-accent">CREATE ACCOUNT</p>

        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-surface p-1" role="radiogroup" aria-label="Account type">
          {(["buyer", "seller"] as const).map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={role === r}
              onClick={() => setRole(r)}
              className={`h-11 rounded-xl text-sm font-semibold transition-colors ${
                role === r ? "bg-gradient-gold text-gold-foreground shadow-gold" : "text-muted-foreground"
              }`}
            >
              {r === "buyer" ? "I'm a buyer" : "I'm a seller"}
            </button>
          ))}
        </div>

        <Field icon={User} placeholder="Full Name" autoComplete="name" error={errors.name?.message} {...register("name")} />
        <Field icon={Phone} placeholder="Phone Number" type="tel" autoComplete="tel" error={errors.phone?.message} {...register("phone")} />
        <Field icon={Mail} placeholder="Email" type="email" autoComplete="email" error={errors.email?.message} {...register("email")} />
        <Field
          icon={Lock}
          placeholder="Password"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          error={errors.password?.message}
          trailing={
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="text-muted-foreground"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          }
          {...register("password")}
        />

        <label className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={agree === true}
            onCheckedChange={(checked) => setValue("agree", (checked === true) as true, { shouldValidate: true })}
            className="mt-0.5 border-gold data-[state=checked]:bg-gold data-[state=checked]:text-gold-foreground"
          />
          <span>
            By creating an account, you agree to our{" "}
            <Link
              to="/terms"
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="font-semibold text-gold underline underline-offset-2"
            >
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link
              to="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="font-semibold text-gold underline underline-offset-2"
            >
              Privacy Policy
            </Link>
          </span>
        </label>
        {errors.agree && <p className="-mt-1 text-xs text-destructive">{errors.agree.message}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-4 flex h-14 items-center justify-center gap-2 rounded-2xl bg-gradient-gold text-base font-semibold text-gold-foreground shadow-gold transition-opacity disabled:opacity-60"
        >
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Continue
        </button>

        <p className="mt-auto pb-8 pt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to="/auth/login" className="font-semibold text-gold">
            Log in
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
        <input
          {...inputProps}
          aria-invalid={Boolean(error)}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {trailing}
      </label>
      {error && <p className="mt-1 pl-1 text-xs text-destructive">{error}</p>}
    </div>
  );
};
