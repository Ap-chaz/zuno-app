import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { User, IdCard, Phone, Mail, Globe, Calendar, Upload, Camera, ImageIcon, CheckCircle2, ShieldCheck, Lock, Clock, Loader2 } from "lucide-react";
import { TopBar } from "@/components/zuno/TopBar";
import { PhoneFrame } from "@/components/zuno/PhoneFrame";
import { useAuth } from "@/hooks/useAuth";
import { authService } from "@/services/auth.service";
import { toast } from "sonner";
import { getRole } from "@/lib/zuno-role";
import { consumeKycIntent, loadKycDraft, saveKycDraft } from "@/lib/zuno-kyc";

type KycSearch = { redirect?: string };

export const Route = createFileRoute("/auth/kyc")({
  head: () => ({ meta: [{ title: "Verify Your Identity — ZUNO" }] }),
  validateSearch: (search: Record<string, unknown>): KycSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: KycScreen,
});

const TOTAL_ITEMS = 9; // 6 detail fields + front/back of ID + selfie

type DocState = { name: string; progress: number; done: boolean; file: File } | null;
type KycForm = {
  fullName: string; idNumber: string; phone: string; email: string; country: string; dob: string;
};

function KycScreen() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const { user, refresh } = useAuth();
  const [form, setForm] = useState<KycForm>({
    fullName: "",
    idNumber: "",
    phone: "",
    email: "",
    country: "Kenya",
    dob: "",
  });
  const [front, setFront] = useState<DocState>(null);
  const [back, setBack] = useState<DocState>(null);
  const [selfie, setSelfie] = useState<DocState>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Restore in-progress draft so users don't start over if they leave midway.
  useEffect(() => {
    const draft = loadKycDraft<KycForm>();
    if (draft) setForm((f) => ({ ...f, ...draft }));
  }, []);
  // Pre-fill what we already know from signup so the person doesn't retype it.
  useEffect(() => {
    if (!user) return;
    setForm((f) => ({
      ...f,
      fullName: f.fullName || user.name || "",
      email: f.email || user.email || "",
      phone: f.phone || user.phone || "",
    }));
  }, [user]);
  useEffect(() => {
    saveKycDraft(form);
  }, [form]);

  const set = (k: keyof KycForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.fullName.trim()) e.fullName = "Required";
    if (!form.idNumber.trim()) e.idNumber = "Required";
    if (!/^\+?[0-9\s-]{7,}$/.test(form.phone)) e.phone = "Enter a valid phone";
    if (!/^\S+@\S+\.\S+$/.test(form.email)) e.email = "Enter a valid email";
    if (!form.country) e.country = "Required";
    if (!form.dob) e.dob = "Required";
    if (!front?.done) e.front = "Upload front of ID";
    if (!back?.done) e.back = "Upload back of ID";
    if (!selfie?.done) e.selfie = "Take a selfie holding your ID";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const completed = [
    form.fullName.trim(),
    form.idNumber.trim(),
    /^\+?[0-9\s-]{7,}$/.test(form.phone),
    /^\S+@\S+\.\S+$/.test(form.email),
    form.country,
    form.dob,
    front?.done,
    back?.done,
    selfie?.done,
  ].filter(Boolean).length;

  const handleContinue = async () => {
    if (!validate() || !front?.file || !selfie?.file) return;
    setSubmitting(true);
    try {
      await authService.submitKyc({
        fullName: form.fullName,
        idNumber: form.idNumber,
        dob: form.dob,
        idFront: front.file,
        idBack: back?.file,
        selfie: selfie.file,
      });
      await refresh();
      toast.success("Documents submitted. We'll review them and send you an SMS.");
      const target = redirect || consumeKycIntent() || (getRole() === "seller" ? "/seller" : "/app");
      navigate({ to: target.startsWith("/") ? target : "/seller" } as never);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't submit your documents. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PhoneFrame>
      <TopBar title="Verify Your Identity" back="/" />
      <div className="flex flex-1 flex-col px-5 pt-3 pb-8">
        {/* Progress — reflects how much of this single form is filled in */}
        <div>
          <div className="flex items-center justify-between text-[10px] font-bold tracking-[0.18em] text-muted-foreground">
            <span>{completed} OF {TOTAL_ITEMS} COMPLETED</span>
            <span className="text-gold">KYC</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface">
            <div
              className="h-full rounded-full bg-gradient-gold transition-all duration-300"
              style={{ width: `${(completed / TOTAL_ITEMS) * 100}%` }}
            />
          </div>
        </div>

        {/* Hero */}
        <div className="mt-5 rounded-3xl border border-border/40 bg-gradient-card p-5 shadow-card">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gold/15 text-gold">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="mt-3 text-xl font-bold leading-tight">Verify your identity</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Complete your KYC to start buying and selling securely on ZUNO.
          </p>
        </div>

        {/* Personal info */}
        <p className="mt-6 px-1 text-xs font-bold tracking-[0.18em] text-muted-foreground">PERSONAL DETAILS</p>
        <div className="mt-3 space-y-3">
          <Field icon={User} placeholder="Full name" value={form.fullName} onChange={set("fullName")} error={errors.fullName} />
          <Field icon={IdCard} placeholder="National ID / Passport number" value={form.idNumber} onChange={set("idNumber")} error={errors.idNumber} />
          <Field icon={Phone} placeholder="Phone number" type="tel" value={form.phone} onChange={set("phone")} error={errors.phone} />
          <Field icon={Mail} placeholder="Email address" type="email" value={form.email} onChange={set("email")} error={errors.email} />
          <SelectField icon={Globe} value={form.country} onChange={set("country")} error={errors.country}>
            <option value="Kenya">Kenya</option>
            <option value="Uganda">Uganda</option>
            <option value="Tanzania">Tanzania</option>
            <option value="Rwanda">Rwanda</option>
            <option value="Nigeria">Nigeria</option>
            <option value="Ghana">Ghana</option>
            <option value="South Africa">South Africa</option>
          </SelectField>
          <Field icon={Calendar} placeholder="Date of birth" type="date" value={form.dob} onChange={set("dob")} error={errors.dob} />
        </div>

        {/* Documents */}
        <p className="mt-6 px-1 text-xs font-bold tracking-[0.18em] text-muted-foreground">DOCUMENT UPLOAD</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <DocUpload label="Front of ID" state={front} setState={setFront} error={errors.front} />
          <DocUpload label="Back of ID" state={back} setState={setBack} error={errors.back} />
          <DocUpload label="Selfie holding your ID" state={selfie} setState={setSelfie} error={errors.selfie} />
        </div>

        {/* Notice */}
        <div className="mt-5 rounded-2xl border border-gold/30 bg-gold/5 p-4">
          <div className="flex items-start gap-3">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
            <div className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
              <p><span className="font-semibold text-foreground">Identity verification protects</span> buyers and sellers on ZUNO.</p>
              <p>Documents are <span className="font-semibold text-foreground">encrypted and securely stored</span>.</p>
              <p className="flex items-center gap-1.5"><Clock className="h-3 w-3 text-gold" /> Verification may take a few minutes.</p>
            </div>
          </div>
        </div>

        {/* CTA */}
        <button
          onClick={handleContinue}
          disabled={submitting}
          className="mt-6 flex h-14 items-center justify-center gap-2 rounded-2xl bg-gradient-gold text-base font-semibold text-gold-foreground shadow-gold disabled:opacity-70"
        >
          {submitting ? (<><Loader2 className="h-5 w-5 animate-spin" /> Submitting…</>) : "Continue"}
        </button>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          Already have an account? <Link to="/auth/login" className="font-semibold text-gold">Sign in</Link>
        </p>
      </div>
    </PhoneFrame>
  );
}

function Field({ icon: Icon, placeholder, type = "text", value, onChange, error }: { icon: typeof User; placeholder: string; type?: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; error?: string }) {
  return (
    <div>
      <label className={`flex h-14 items-center gap-3 rounded-2xl border bg-input px-4 transition-colors focus-within:border-gold/60 ${error ? "border-destructive/60" : "border-border/60"}`}>
        <Icon className="h-4 w-4 text-muted-foreground" />
        <input type={type} placeholder={placeholder} value={value} onChange={onChange} className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
      </label>
      {error && <p className="mt-1 px-1 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

function SelectField({ icon: Icon, value, onChange, error, children }: { icon: typeof Globe; value: string; onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={`flex h-14 items-center gap-3 rounded-2xl border bg-input px-4 focus-within:border-gold/60 ${error ? "border-destructive/60" : "border-border/60"}`}>
        <Icon className="h-4 w-4 text-muted-foreground" />
        <select value={value} onChange={onChange} className="flex-1 bg-transparent text-sm outline-none">
          {children}
        </select>
      </label>
      {error && <p className="mt-1 px-1 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

function DocUpload({ label, state, setState, error }: { label: string; state: DocState; setState: (s: DocState) => void; error?: string }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 10 * 1024 * 1024 || !f.type.startsWith("image/")) {
      toast.error("Choose a JPG or PNG photo under 10MB.");
      return;
    }
    setState({ name: f.name, progress: 100, done: true, file: f });
  };

  return (
    <div>
      <div className={`rounded-2xl border-2 border-dashed p-4 transition-colors ${state?.done ? "border-success/50 bg-success/5" : error ? "border-destructive/60 bg-destructive/5" : "border-border bg-surface"}`}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold tracking-wider text-muted-foreground">{label.toUpperCase()}</p>
          {state?.done && <CheckCircle2 className="h-4 w-4 text-success" />}
        </div>
        <p className="mt-1 truncate text-sm font-semibold">{state?.name ?? "No file selected"}</p>
        {state && !state.done && (
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-background">
            <div className="h-full rounded-full bg-gradient-gold transition-all" style={{ width: `${state.progress}%` }} />
          </div>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => cameraRef.current?.click()} className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-border bg-background text-xs font-semibold">
            <Camera className="h-3.5 w-3.5 text-gold" /> Camera
          </button>
          <button type="button" onClick={() => galleryRef.current?.click()} className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-border bg-background text-xs font-semibold">
            <ImageIcon className="h-3.5 w-3.5 text-gold" /> Gallery
          </button>
        </div>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
        <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
        {!state && (
          <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground"><Upload className="h-3 w-3" /> JPG or PNG, up to 10MB</p>
        )}
      </div>
      {error && <p className="mt-1 px-1 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
