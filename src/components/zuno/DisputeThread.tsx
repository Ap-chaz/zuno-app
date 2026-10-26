import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, Upload, Handshake } from "lucide-react";
import { toast } from "sonner";
import { TopBar } from "@/components/zuno/TopBar";
import { disputesService } from "@/services/disputes.service";
import { useDisputes } from "@/hooks/queries/useDisputes";
import { useTransaction } from "@/hooks/queries/useTransactions";
import { errorMessage } from "@/lib/api/client";

const fmt = (n: number) => `Ksh ${n.toLocaleString("en-KE")}`;

/** Buyer/seller conversation, settlement offers and escalation for one dispute. */
export function DisputeThread({ id, backTo }: { id: string; backTo: string }) {
  const qc = useQueryClient();
  const { data: disputes } = useDisputes();
  const dispute = disputes?.find((d) => d.id === id);
  const { data: tx } = useTransaction(dispute?.transactionId);
  const thread = useQuery({ queryKey: ["dispute-thread", id], queryFn: () => disputesService.thread(id), refetchInterval: 15000 });
  const [text, setText] = useState("");
  const [offer, setOffer] = useState("");
  const [counter, setCounter] = useState<Record<string, string>>({});

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["dispute-thread", id] });
    qc.invalidateQueries({ queryKey: ["disputes"] });
    qc.invalidateQueries({ queryKey: ["transactions"] });
  };
  const act = useMutation({
    mutationFn: (fn: () => Promise<void>) => fn(),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });

  const closed = !dispute || dispute.status === "resolved" || dispute.status === "rejected";
  const maxRefund = tx?.sellerReceives ?? 0;
  const role = thread.data?.viewerRole;

  const sendOffer = () => {
    const amt = Math.round(Number(offer));
    if (!amt || amt < 1 || (maxRefund && amt > maxRefund)) return toast.error(`Enter a refund between Ksh 1 and ${fmt(maxRefund)}.`);
    act.mutate(async () => { await disputesService.makeOffer(id, amt, ""); setOffer(""); toast.success("Offer sent."); });
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <TopBar title="Dispute" back={backTo} />
      <div className="px-5 pt-4 pb-8">
        {dispute && (
          <div className="rounded-3xl border border-border/40 bg-surface p-4">
            <div className="flex items-center justify-between">
              <p className="font-mono text-xs font-bold">#{dispute.transactionId}</p>
              <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold capitalize text-destructive">
                {dispute.status.replace("_", " ")}
              </span>
            </div>
            <p className="mt-2 text-sm font-semibold capitalize">{dispute.reason}</p>
            <p className="mt-1 text-xs text-muted-foreground">{dispute.description}</p>
            {dispute.resolution && (
              <p className="mt-3 rounded-xl bg-surface-2 p-3 text-xs">
                Outcome: <b>{dispute.resolution === "SPLIT"
                  ? `Split — buyer ${fmt(dispute.splitBuyerAmount ?? 0)}, seller ${fmt(dispute.splitSellerAmount ?? 0)}`
                  : dispute.resolution === "REFUND_BUYER" ? "Refunded to buyer" : "Released to seller"}</b>
                {dispute.resolutionNote ? ` — ${dispute.resolutionNote}` : ""}
              </p>
            )}
          </div>
        )}

        <div className="mt-5 space-y-2">
          {thread.isLoading && <Loader2 className="mx-auto h-5 w-5 animate-spin" />}
          {thread.data?.messages.map((m) => (
            <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.mine ? "bg-gradient-gold text-gold-foreground" : "bg-surface"}`}>
                <p className="mb-0.5 text-[10px] font-semibold uppercase opacity-70">{m.mine ? "You" : m.senderRole}</p>
                {m.isOffer && m.offerAmount != null && (
                  <p className="font-semibold"><Handshake className="mr-1 inline h-3.5 w-3.5" />
                    Offer: refund buyer {fmt(m.offerAmount)} <span className="text-[10px] font-normal">({(m.offerStatus ?? "").toLowerCase()})</span></p>
                )}
                {m.text && <p>{m.text}</p>}
                {m.isOffer && m.offerStatus === "PENDING" && !m.mine && !closed && (
                  <div className="mt-2 space-y-2">
                    <div className="flex gap-2">
                      <button disabled={act.isPending} onClick={() => act.mutate(async () => { await disputesService.respondToOffer(id, m.id, "ACCEPTED"); toast.success("Offer accepted. Settling now."); })}
                        className="h-9 flex-1 rounded-lg bg-success text-xs font-semibold text-white">Accept</button>
                      <button disabled={act.isPending} onClick={() => act.mutate(() => disputesService.respondToOffer(id, m.id, "REJECTED"))}
                        className="h-9 flex-1 rounded-lg border border-border text-xs font-semibold">Reject</button>
                    </div>
                    <div className="flex gap-2">
                      <input inputMode="numeric" placeholder="Counter (Ksh)" value={counter[m.id] ?? ""}
                        onChange={(e) => setCounter({ ...counter, [m.id]: e.target.value })}
                        className="h-9 min-w-0 flex-1 rounded-lg border border-border/60 bg-input px-2 text-xs" />
                      <button disabled={act.isPending} onClick={() => { const a = Number(counter[m.id]); if (!a) return toast.error("Enter a counter amount."); act.mutate(() => disputesService.respondToOffer(id, m.id, "COUNTERED", a)); }}
                        className="h-9 rounded-lg border border-border px-3 text-xs font-semibold">Counter</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
          {thread.data && thread.data.messages.length === 0 && (
            <p className="text-center text-xs text-muted-foreground">No messages yet. Talk to the other party to settle this quickly.</p>
          )}
        </div>

        {!closed && (
          <div className="mt-5 space-y-3">
            <div className="flex gap-2">
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message…"
                className="h-11 min-w-0 flex-1 rounded-xl border border-border/60 bg-input px-3 text-sm" />
              <button disabled={act.isPending || !text.trim()} aria-label="Send"
                onClick={() => act.mutate(async () => { await disputesService.sendMessage(id, text.trim()); setText(""); })}
                className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-gold text-gold-foreground disabled:opacity-50"><Send className="h-4 w-4" /></button>
            </div>

            {dispute?.status !== "under_review" && (
              <div className="rounded-2xl border border-border/40 bg-surface p-3">
                <p className="text-xs font-semibold">Propose a settlement</p>
                <p className="text-[11px] text-muted-foreground">
                  Amount refunded to the buyer{maxRefund ? ` (up to ${fmt(maxRefund)})` : ""}. The seller keeps the rest.
                </p>
                <div className="mt-2 flex gap-2">
                  <input inputMode="numeric" value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="Refund amount (Ksh)"
                    className="h-10 min-w-0 flex-1 rounded-lg border border-border/60 bg-input px-3 text-sm" />
                  <button disabled={act.isPending} onClick={sendOffer} className="h-10 rounded-lg bg-gradient-gold px-4 text-xs font-semibold text-gold-foreground">Send offer</button>
                </div>
              </div>
            )}

            <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border text-xs font-semibold text-muted-foreground hover:border-gold/50">
              <Upload className="h-3.5 w-3.5" /> Add evidence (photo or PDF)
              <input type="file" className="hidden" accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) act.mutate(async () => { await disputesService.uploadEvidence(id, f, "photo"); toast.success("Evidence uploaded."); }); }} />
            </label>

            {dispute?.status !== "under_review" && (
              <button disabled={act.isPending}
                onClick={() => { if (confirm("Escalate to ZUNO admin? An admin will make the final decision.")) act.mutate(async () => { await disputesService.escalate(id); toast.success("Escalated to admin."); }); }}
                className="h-11 w-full rounded-xl border border-destructive/40 text-xs font-semibold text-destructive">Escalate to admin</button>
            )}
            {role && <p className="text-center text-[10px] text-muted-foreground">You are the {role} in this deal.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
