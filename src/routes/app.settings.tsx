import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Bell, Lock, CreditCard, Eye, Moon, Globe, ChevronRight, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { TopBar } from "@/components/zuno/TopBar";
import { useTheme } from "@/components/zuno/ThemeToggle";
import { useAuth } from "@/hooks/useAuth";
import { authService } from "@/services/auth.service";
import { useLanguage } from "@/hooks/useLanguage";
import { useHideBalances } from "@/hooks/useHideBalances";
import { LANGUAGES } from "@/lib/i18n/translations";
import {
  clearBiometric,
  hasRegisteredBiometric,
  isBiometricSupported,
  registerBiometric,
} from "@/lib/webauthn";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/app/settings")({
  head: () => ({ meta: [{ title: "Settings — ZUNO" }] }),
  component: () => <SettingsPage backTo="/app/account" />,
});

export function SettingsPage({ backTo = "/app/account" }: { backTo?: string }) {
  const { theme, toggle } = useTheme();
  const { user } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const [biometric, setBiometric] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const { hidden: hideBalances, setHidden: setHideBalances } = useHideBalances();
  const [langOpen, setLangOpen] = useState(false);

  useEffect(() => {
    setBiometric(hasRegisteredBiometric());
  }, []);

  const comingSoon = (label: string) => toast.info(`${label} is coming soon.`);

  const handleBiometricToggle = async () => {
    if (biometric) {
      clearBiometric();
      authService.clearBiometricSession();
      setBiometric(false);
      toast.success("Biometric login turned off.");
      return;
    }
    if (!isBiometricSupported()) {
      toast.error("This device or browser doesn't support biometric login.");
      return;
    }
    setIsRegistering(true);
    try {
      const ok = await registerBiometric(user?.id ?? "zuno_user", user?.name ?? "ZUNO User");
      if (ok) {
        const currentSession = authService.getStoredSession();
        if (currentSession) authService.saveBiometricSession(currentSession);
        setBiometric(true);
        toast.success("Biometric login enabled on this device.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't set up biometric login.");
    } finally {
      setIsRegistering(false);
    }
  };

  const currentLanguageLabel = LANGUAGES.find((l) => l.code === language)?.nativeLabel ?? "English";

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <TopBar title={t("settings_title")} back={backTo} />
      <div className="px-4 sm:px-6 pt-4 pb-8 space-y-6">
        <Section title={t("settings_security")}>
          <Toggle
            icon={isRegistering ? Loader2 : Lock}
            label={t("settings_biometric_login")}
            on={biometric}
            onChange={handleBiometricToggle}
            disabled={isRegistering}
            iconClassName={isRegistering ? "animate-spin" : undefined}
          />
          <Toggle icon={Eye} label={t("settings_hide_balances")} on={hideBalances} onChange={() => setHideBalances(!hideBalances)} />
          <Row icon={Lock} label={t("settings_change_password")} as={Link} to="/auth/forgot" />
          <Row icon={Lock} label={t("settings_two_factor")} badge="Coming soon" onClick={() => comingSoon("Two-factor authentication settings")} />
        </Section>

        <Section title={t("settings_payments")}>
          <Row icon={CreditCard} label={user?.phone ? `M-PESA · ${user.phone}` : "M-PESA"} badge="Default" onClick={() => comingSoon("Managing payment methods")} />
          <Row icon={CreditCard} label="Card payments" badge="Coming soon" onClick={() => comingSoon("Card payments")} />
          <Row icon={CreditCard} label="Add new method" badge="Coming soon" onClick={() => comingSoon("Adding a payment method")} />
        </Section>

        <Section title={t("settings_preferences")}>
          <Row icon={Bell} label={t("settings_push_notifications")} badge="Coming soon" onClick={() => comingSoon("Push notifications")} />
          <Toggle icon={Moon} label={t("settings_dark_mode")} on={theme === "dark"} onChange={toggle} />

          <li>
            <Dialog open={langOpen} onOpenChange={setLangOpen}>
              <DialogTrigger asChild>
                <button className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-gold">
                    <Globe className="h-4 w-4" />
                  </span>
                  <span className="flex-1 text-sm font-medium">{t("settings_language")}</span>
                  <span className="rounded-full border border-border/60 bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    {currentLanguageLabel}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("settings_language")}</DialogTitle>
                </DialogHeader>
                <ul className="space-y-2">
                  {LANGUAGES.map((l) => (
                    <li key={l.code}>
                      <button
                        onClick={() => {
                          setLanguage(l.code);
                          setLangOpen(false);
                          toast.success(`Language set to ${l.nativeLabel}`);
                        }}
                        className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-sm font-medium transition-colors ${
                          language === l.code ? "border-gold bg-gold/10 text-gold" : "border-border/60 bg-surface hover:bg-surface-2"
                        }`}
                      >
                        {l.nativeLabel}
                        {language === l.code && <Check className="h-4 w-4" />}
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-muted-foreground">
                  More languages are on the way — navigation, Home, Settings, and Account are translated so far.
                </p>
              </DialogContent>
            </Dialog>
          </li>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 px-2 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{title}</p>
      <ul className="divide-y divide-border/40 overflow-hidden rounded-2xl border border-border/40 bg-surface">{children}</ul>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  badge,
  onClick,
  as: Comp = "button",
  to,
}: {
  icon: typeof Lock;
  label: string;
  badge?: string;
  onClick?: () => void;
  as?: typeof Link | "button";
  to?: string;
}) {
  const content = (
    <>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-gold">
        <Icon className="h-4 w-4" />
      </span>
      <span className="flex-1 text-left text-sm font-medium">{label}</span>
      {badge && <span className="rounded-full border border-border/60 bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{badge}</span>}
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </>
  );
  return (
    <li>
      {Comp === Link && to ? (
        <Link to={to} className="flex w-full items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2">
          {content}
        </Link>
      ) : (
        <button onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2">
          {content}
        </button>
      )}
    </li>
  );
}

function Toggle({
  icon: Icon,
  label,
  on,
  onChange,
  disabled,
  iconClassName,
}: {
  icon: typeof Lock;
  label: string;
  on?: boolean;
  onChange?: () => void;
  disabled?: boolean;
  iconClassName?: string;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-gold">
        <Icon className={`h-4 w-4 ${iconClassName ?? ""}`} />
      </span>
      <span className="flex-1 text-sm font-medium">{label}</span>
      <button
        type="button"
        onClick={onChange}
        disabled={disabled}
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-colors disabled:opacity-60 ${on ? "bg-gold" : "bg-muted"}`}
      >
        <span className={`h-5 w-5 rounded-full bg-surface shadow transition-transform ${on ? "translate-x-5" : ""}`} />
      </button>
    </li>
  );
}
