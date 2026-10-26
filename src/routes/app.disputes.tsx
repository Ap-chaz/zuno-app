import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, Upload, FileText, Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { TopBar } from "@/components/zuno/TopBar";
import { EmptyState, ListSkeleton } from "@/components/common/StateViews";
import { useCreateDispute, useDisputes } from "@/hooks/queries/useDisputes";
import { useTransactions } from "@/hooks/queries/useTransactions";
import { disputesService } from "@/services/disputes.service";
import { errorMessage } from "@/lib/api/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const BUYER_REASONS = [
  { title: "Item not received", desc: "Seller hasn't delivered within agreed time" },
  { title: "Item not as described", desc: "Product differs from listing" },
  { title: "Damaged on arrival", desc: "Item arrived broken or defective" },
  { title: "Other issue", desc: "Tell us what happened" },
];

/** Statuses the API accepts a dispute for. */
const DISPUTABLE = ["Funded", "Protected", "In transit", "Inspection"];

export const Route = createFileRoute("/app/disputes")({
  head: () => ({ meta: [{ title: "Dispute Center — ZUNO" }] }),
  validateSearch: (s: Record<string, unknown>): { tx?: string } => ({ tx: typeof s.tx === "string" ? s.tx : undefined }),
  component: BuyerDisputes,
});

function BuyerDisputes() {
  const { tx } = Route.useSearch();
  return (
    <Disputes
      backTo="/app"
      helpTo="/help"
      threadBase="/app/dispute"
      emptyOrdersLabel="No paid orders to report"
      reasons={BUYER_REASONS}
      presetTx={tx}
    />
  );
}

export function Disputes({
  backTo,
  helpTo,
  threadBase,
  emptyOrdersLabel,
  reasons,
  presetTx,
}: {
  backTo: string;
  helpTo: string;
  threadBase: string;
  emptyOrdersLabel: string;
  reasons: { title: string; desc: string }[];
  presetTx?: string;
}) {
  const { data: disputes, isLoading } = useDisputes();
  const { data: txs } = useTransactions();
  const orderOptions = (txs ?? [])
    .filter((t) => DISPUTABLE.includes(t.status))
    .map((t) => ({ id: t.id, label: `${t.item} · ${t.buyerName ?? t.seller}` }));
  const [openReason, setOpenReason] = useState<string | null>(null);
  const [transactionId, setTransactionId] = useState(presetTx ?? "");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const createDispute = useCreateDispute();

  const resetForm = () => {
    setOpenReason(null);
    setTransactionId("");
    setDescription("");
    setFile(null);
  };

  const handleSubmit = async () => {
    if (!transactionId || !openReason) return toast.error("Select the order.");
    if (description.trim().length < 20) return toast.error("Describe what happened in at least 20 characters.");
    setBusy(true);
    try {
      const d = await createDispute.mutateAsync({ transactionId, reason: openReason, description });
      if (file) {
        try {
          await disputesService.uploadEvidence(d.id, file, "photo");
        } catch {
          toast.error("Dispute filed, but the evidence upload failed. Add it from the dispute page.");
        }
      }
      toast.success("Dispute filed. Our team will review it.");
      resetForm();
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't file the dispute."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <TopBar title="Dispute Center" back={backTo} />

      <div className="px-4 sm:px-6 pt-4 pb-8">
        <div className="rounded-3xl border border-destructive/30 bg-destructive/10 p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-destructive/20 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div>
              <p className="font-semibold">We're here to help</p>
              <p className="text-xs text-muted-foreground">Funds stay locked in escrow until it's resolved.</p>
            </div>
          </div>
        </div>

        <p className="mt-6 text-xs font-bold tracking-[0.18em] text-muted-foreground">OPEN A DISPUTE</p>
        <div className="mt-3 space-y-3">
          {reasons.map((r) => (
            <Card key={r.title} icon={FileText} title={r.title} desc={r.desc} onClick={() => setOpenReason(r.title)} />
          ))}
        </div>

        <Dialog open={openReason !== null} onOpenChange={(open) => !open && setOpenReason(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{openReason}</DialogTitle>
              <DialogDescription>Select the order and tell us what happened.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Select value={transactionId} onValueChange={setTransactionId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an order" />
                </SelectTrigger>
                <SelectContent>
                  {orderOptions.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">{emptyOrdersLabel}</div>
                  ) : (
                    orderOptions.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.label}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what happened (at least 20 characters)…"
                rows={4}
                className="w-full rounded-2xl border border-border/60 bg-input p-3 text-sm outline-none placeholder:text-muted-foreground focus:border-gold/50"
              />
              <label className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border text-xs font-semibold text-muted-foreground hover:border-gold/50 hover:text-gold">
                <Upload className="h-3.5 w-3.5" /> {file ? file.name : "Attach a photo or PDF (optional)"}
                <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
            <DialogFooter>
              <button
                onClick={handleSubmit}
                disabled={busy}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-gold text-sm font-semibold text-gold-foreground shadow-gold disabled:opacity-60"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Submit Dispute
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <p className="mt-6 text-xs font-bold tracking-[0.18em] text-muted-foreground">YOUR DISPUTES</p>
        <div className="mt-3 space-y-3">
          {isLoading && <ListSkeleton rows={1} />}
          {!isLoading && (disputes?.length ?? 0) === 0 && (
            <EmptyState icon={AlertTriangle} title="No disputes" description="Filed disputes will show up here." />
          )}
          {!isLoading &&
            disputes?.map((d) => (
              <Link
                key={d.id}
                to={`${threadBase}/$id` as never}
                params={{ id: d.id } as never}
                className="block rounded-3xl border border-border/40 bg-surface p-4"
              >
                <div className="flex items-center justify-between">
                  <p className="font-mono text-xs font-bold">#{d.transactionId}</p>
                  <span className="rounded-full border border-destructive/30 bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold capitalize text-destructive">
                    {d.status.replace("_", " ")}
                  </span>
                </div>
                <p className="mt-2 text-sm font-semibold capitalize">{d.reason}</p>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  Reported {new Date(d.createdAt).toLocaleDateString("en-GB")} · {d.description}
                </p>
                <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-gold">
                  <MessageCircle className="h-3.5 w-3.5" /> Open chat & offers
                </p>
              </Link>
            ))}
        </div>
        <Link to={helpTo as never} className="mt-6 block text-center text-xs text-muted-foreground underline">
          Need help? Contact support
        </Link>
      </div>
    </div>
  );
}

function Card({ icon: Icon, title, desc, onClick }: { icon: typeof FileText; title: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl border border-border/40 bg-surface p-4 text-left transition-colors hover:border-gold/30">
      <span className="grid h-10 w-10 place-items-center rounded-2xl bg-surface-2 text-gold">
        <Icon className="h-4 w-4" />
      </span>
      <div className="flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </button>
  );
}
