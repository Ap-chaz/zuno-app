import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ShieldCheck, CheckCheck, RotateCcw } from "lucide-react";
import { currency } from "@/lib/zuno-data";
import { DemoWalkthrough } from "@/components/zuno/DemoWalkthrough";

export const Route = createFileRoute("/app/demo")({
  head: () => ({ meta: [{ title: "Live Demo — ZUNO" }] }),
  component: DemoPage,
});

const AMOUNT = 191311;

type Msg =
  | { from: "buyer"; kind: "image"; text: string }
  | { from: "buyer" | "seller"; kind: "text"; text: string };

const SCRIPT: Msg[] = [
  { from: "buyer", kind: "image", text: "Hi 👋 Do you have the iPhone 17 Pro Max in stock?" },
  { from: "seller", kind: "text", text: "Hey 👋" },
  { from: "seller", kind: "text", text: "Yes, it's available." },
  { from: "buyer", kind: "text", text: "How much?" },
  { from: "seller", kind: "text", text: `${currency(AMOUNT)}.` },
  { from: "seller", kind: "text", text: "We can send it today." },
  { from: "buyer", kind: "text", text: "Great, let's do it through ZUNO so we're both covered 👍" },
];

type Phase = "chat" | "flow";

/**
 * A fully passive, watch-only demo: a scripted WhatsApp-style chat plays
 * out first (setting the scene — a buyer messaging a seller), then flows
 * into <DemoWalkthrough />, a timed walkthrough of the real deal process
 * (request, seller confirms, payment request, M-Pesa, delivery, inspection,
 * payout). Nobody has to type or tap anything, and nothing is saved.
 */
function DemoPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("chat");
  const [visible, setVisible] = useState(0);
  const [typingFrom, setTypingFrom] = useState<"buyer" | "seller" | null>(null);
  const [flowKey, setFlowKey] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  function restart() {
    setPhase("chat");
    setVisible(0);
    setTypingFrom(null);
    setFlowKey((k) => k + 1);
  }

  // Reveal the scripted chat one message at a time, with a brief "typing…"
  // beat before whichever side is about to "send" the next message —
  // purely a front-end animation, nothing here is a real conversation.
  useEffect(() => {
    if (phase !== "chat") return;
    if (visible >= SCRIPT.length) {
      const t = setTimeout(() => setPhase("flow"), 2600);
      return () => clearTimeout(t);
    }
    const next = SCRIPT[visible];
    const typingDelay = visible === 0 ? 700 : 1500;
    const t1 = setTimeout(() => setTypingFrom(next.from), typingDelay);
    const t2 = setTimeout(
      () => {
        setTypingFrom(null);
        setVisible((v) => v + 1);
      },
      typingDelay + (next.kind === "image" ? 1400 : 1100),
    );
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [phase, visible]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [visible, typingFrom]);

  if (phase === "flow") {
    return <DemoWalkthrough key={flowKey} onRestart={restart} />;
  }

  return (
    <div className="flex-1 overflow-y-auto pb-8">
      <div className="mx-auto w-full max-w-[460px] px-5 sm:px-0 md:max-w-[520px] lg:max-w-[560px] xl:max-w-[620px]">
        <header className="flex items-center gap-3 pt-6 lg:pt-0">
          <button
            onClick={() => navigate({ to: "/app" })}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface hover:bg-surface-2"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold lg:text-2xl">See ZUNO in action</h1>
            <p className="truncate text-xs text-muted-foreground lg:text-sm">
              Just watch — a real deal, start to finish.
            </p>
          </div>
        </header>

        <div className="mt-5 lg:mt-6">
          <div className="overflow-hidden rounded-[2rem] border border-border/40 bg-[#0b141a] shadow-card">
            <div className="flex h-[clamp(420px,calc(100dvh_-_17rem),720px)] flex-col text-white">
            <div className="flex items-center gap-3 border-b border-white/10 bg-[#202c33] px-4 py-3">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-violet text-xs font-bold">GW</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">Gadget World</p>
                <p className="text-[11px] text-white/50">online</p>
              </div>
              <DemoBadge />
            </div>

            <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3 hide-scrollbar">
              <div className="mx-auto max-w-[300px] rounded-lg bg-white/10 px-3 py-2 text-center text-[11px] md:text-xs text-white/70">
                This is a demo. Nothing will be charged and no delivery will be created.
              </div>

              {SCRIPT.slice(0, visible).map((m, i) => (
                <Bubble key={i} msg={m} />
              ))}

              {typingFrom && (
                <div className={`flex ${typingFrom === "buyer" ? "justify-end" : "justify-start"}`}>
                  <div className={`rounded-2xl px-3 py-2 ${typingFrom === "buyer" ? "bg-[#005c4b]" : "bg-[#202c33]"}`}>
                    <span className="flex gap-1">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/60 [animation-delay:-0.3s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/60 [animation-delay:-0.15s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/60" />
                    </span>
                  </div>
                </div>
              )}

              {visible >= SCRIPT.length && (
                <p className="flex items-center justify-center gap-1.5 pt-2 text-center text-[11px] text-white/40">
                  <ShieldCheck className="h-3 w-3" /> Starting the walkthrough…
                </p>
              )}
            </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 px-4 text-center sm:px-6 lg:mt-6">
        <button onClick={restart} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
          <RotateCcw className="h-3 w-3" /> Restart demo
        </button>
      </div>
    </div>
  );
}

function DemoBadge() {
  return <span className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[10px] font-bold tracking-wide text-white">DEMO</span>;
}

function Bubble({ msg }: { msg: Msg }) {
  const mine = msg.from === "buyer";
  const bubbleBg = mine ? "bg-[#005c4b]" : "bg-[#202c33]";

  return (
    <div className={`flex animate-in fade-in slide-in-from-bottom-2 duration-300 ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[78%] rounded-2xl ${bubbleBg} px-3 py-2 text-sm md:text-[15px]`}>
        {msg.kind === "image" && (
          <div className="mb-1.5 overflow-hidden rounded-lg bg-white/10">
            <div className="flex h-28 items-center justify-center text-3xl">📱</div>
          </div>
        )}
        <p>{msg.text}</p>
        <span className="mt-1 flex items-center justify-end gap-1 text-[10px] text-white/50">
          10:27 {mine && <CheckCheck className="h-3 w-3 text-sky-300" />}
        </span>
      </div>
    </div>
  );
}
