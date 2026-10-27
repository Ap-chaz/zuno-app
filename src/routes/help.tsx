import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { MessageCircle, AlertTriangle, Mail, ChevronDown, Search, SearchX } from "lucide-react";
import { toast } from "sonner";
import { TopBar } from "@/components/zuno/TopBar";
import { PhoneFrame } from "@/components/zuno/PhoneFrame";
import { EmptyState } from "@/components/common/StateViews";

export const Route = createFileRoute("/help")({
  head: () => ({ meta: [{ title: "Help & Support — ZUNO" }] }),
  component: () => <Help backTo="/app/account" reportTo="/app/disputes" />,
});

const faqs = [
  { q: "How does ZUNO escrow work?", a: "You pay into ZUNO, we hold the funds, the seller delivers, then you confirm and the seller is paid. Funds are never released early." },
  { q: "What if my item never arrives?", a: "Open a dispute within the protection window. ZUNO investigates within 48 hours and refunds you in full if the seller fails to deliver." },
  { q: "How are sellers verified?", a: "Every seller goes through national ID verification, biometric selfie match, and business document checks before going live." },
  { q: "What are the fees?", a: "ZUNO charges a small escrow fee (typically 1.25%) on the buyer side and 1.25% on the seller side" },
  { q: "Is my money safe?", a: "Funds are held in licensed partner banks under regulated custody with full audit trails." },
];

/**
 * `embedded` = rendered inside the seller/buyer AppShell, which already
 * provides the height-bounded frame, sidebar and bottom nav. In that case we
 * must NOT wrap in <PhoneFrame> (its 100dvh min-height overflows the shell,
 * so the page can't scroll properly and the last card hides behind the bottom nav).
 */
export function Help({ backTo, reportTo, embedded = false }: { backTo: string; reportTo: string; embedded?: boolean }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState<number | null>(0);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return faqs;
    return faqs.filter((f) => f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q));
  }, [query]);

  const startChat = () => toast.info("Live chat is coming soon — email us in the meantime.");

  const Frame = embedded ? EmbeddedFrame : PhoneFrame;

  return (
    <Frame>
      <TopBar title="Help & Support" back={backTo} />
      <div className={`min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-8 ${embedded ? "lg:px-0" : ""}`}>
        <label className="flex h-12 items-center gap-3 rounded-2xl border border-border/60 bg-input px-4 focus-within:border-gold/50">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search help articles"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <Quick icon={MessageCircle} label="Chat" gold onClick={startChat} />
          <Quick icon={Mail} label="Email" onClick={() => (window.location.href = "mailto:support@zuno.app")} />
          <Quick icon={AlertTriangle} label="Report" onClick={() => navigate({ to: reportTo })} />
        </div>

        <p className="mt-6 px-1 text-xs font-bold tracking-[0.18em] text-muted-foreground">FREQUENTLY ASKED</p>
        {filtered.length === 0 ? (
          <div className="mt-3">
            <EmptyState icon={SearchX} title="No matching articles" description="Try a different search term, or start a chat below." />
          </div>
        ) : (
          <ul className="mt-3 space-y-2 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3 lg:space-y-0">
            {filtered.map((f) => {
              const i = faqs.indexOf(f);
              return (
                <li key={f.q} className="overflow-hidden rounded-2xl border border-border/40 bg-surface">
                  <button onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
                    <span className="text-sm font-semibold">{f.q}</span>
                    <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open === i ? "rotate-180" : ""}`} />
                  </button>
                  {open === i && <p className="border-t border-border/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground">{f.a}</p>}
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-6 rounded-2xl border border-gold/30 bg-gold/5 p-4 text-center">
          <p className="text-sm font-semibold">Still need help?</p>
          <p className="mt-1 text-xs text-muted-foreground">Our team typically replies in under 5 minutes.</p>
          <button
            onClick={startChat}
            className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-gold text-sm font-semibold text-gold-foreground transition-opacity hover:opacity-95"
          >
            <MessageCircle className="h-4 w-4" /> Start a chat
          </button>
        </div>
      </div>
    </Frame>
  );
}

function EmbeddedFrame({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col">{children}</div>;
}

function Quick({ icon: Icon, label, gold, onClick }: { icon: typeof MessageCircle; label: string; gold?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-2 rounded-2xl border p-4 transition-colors hover:bg-surface-2 ${gold ? "border-gold/40 bg-gold/10" : "border-border/40 bg-surface"}`}
    >
      <Icon className={`h-5 w-5 ${gold ? "text-gold" : "text-foreground"}`} />
      <span className="text-xs font-semibold">{label}</span>
    </button>
  );
}
