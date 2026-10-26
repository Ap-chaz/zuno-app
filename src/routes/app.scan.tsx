import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, ShieldAlert, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { ThemeToggle } from "@/components/zuno/ThemeToggle";

export const Route = createFileRoute("/app/scan")({
  head: () => ({ meta: [{ title: "Scan QR — ZUNO" }] }),
  component: ScanQR,
});

function ScanQR() {
  const navigate = useNavigate();
  const containerId = "zuno-qr-reader";
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const [status, setStatus] = useState<"idle" | "starting" | "scanning" | "denied" | "error" | "success">("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [result, setResult] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function start() {
      setStatus("starting");
      try {
        const mod = await import("html5-qrcode");
        const Html5Qrcode = mod.Html5Qrcode;
        if (cancelled) return;

        // Request camera permission by enumerating devices via getUserMedia first
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
          stream.getTracks().forEach((t) => t.stop());
        } catch (permErr) {
          const name = (permErr as DOMException)?.name || "";
          if (name === "NotAllowedError" || name === "PermissionDeniedError") {
            setStatus("denied");
            return;
          }
          throw permErr;
        }

        const scanner = new Html5Qrcode(containerId, { verbose: false });
        scannerRef.current = scanner as unknown as { stop: () => Promise<void>; clear: () => void };

        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          async (decodedText: string) => {
            if (cancelled) return;
            setResult(decodedText);
            setStatus("success");
            try {
              await scanner.stop();
              scanner.clear();
            } catch {
              /* noop */
            }
            toast.success("QR code scanned");
            // Route based on payload
            setTimeout(() => {
              // Only ever navigate inside ZUNO. Anything else is refused (no open redirects).
              const seller = decodedText.match(/^zuno:seller:([A-Za-z0-9_-]+)$/);
              const pay = decodedText.match(/^zuno:pay:([A-Za-z0-9_-]+)$/);
              let internal: string | null = null;
              try {
                const u = new URL(decodedText);
                if (u.origin === window.location.origin) internal = u.pathname + u.search;
              } catch {
                /* not a URL */
              }
              if (seller) {
                navigate({ to: "/app/seller/$id", params: { id: seller[1] } });
              } else if (pay) {
                navigate({ to: "/pay/$transactionId", params: { transactionId: pay[1] } });
              } else if (internal && /^\/(pay|app\/seller)\//.test(internal)) {
                window.location.assign(internal);
              } else {
                toast.error("That QR code isn't a ZUNO code.");
                setStatus("error");
                setErrorMsg("That QR code isn't a ZUNO code. Only ZUNO seller and payment codes are accepted.");
              }
            }, 800);
          },
          () => {
            /* ignore per-frame decode errors */
          },
        );
        if (!cancelled) setStatus("scanning");
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setErrorMsg((err as Error)?.message || "Unable to start camera");
          setStatus("error");
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s) {
        s.stop().then(() => s.clear()).catch(() => {
          try { s.clear(); } catch { /* noop */ }
        });
      }
    };
  }, [navigate]);

  return (
    <div className="flex flex-1 flex-col bg-background">
      <header className="flex items-center gap-3 px-4 sm:px-6 pt-6 pb-3">
        <button
          onClick={() => navigate({ to: "/app" })}
          className="grid h-10 w-10 place-items-center rounded-xl bg-surface"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="flex-1 text-lg font-bold">Scan QR</h1>
        <ThemeToggle />
      </header>

      <div className="mx-5 mt-2 flex-1 overflow-hidden rounded-3xl border border-border/40 bg-black">
        <div id={containerId} className="h-full min-h-[360px] w-full" />
      </div>

      <div className="px-4 sm:px-6 pb-6 pt-4">
        {status === "starting" && (
          <p className="text-center text-sm text-muted-foreground">Requesting camera access…</p>
        )}
        {status === "scanning" && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Camera className="h-4 w-4 text-gold" /> Point your camera at a QR code
          </div>
        )}
        {status === "success" && (
          <div className="flex items-center justify-center gap-2 text-sm font-semibold text-success">
            <CheckCircle2 className="h-4 w-4" /> Scanned: <span className="truncate max-w-[200px]">{result}</span>
          </div>
        )}
        {status === "denied" && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
            <div className="flex items-center gap-2 font-semibold text-destructive">
              <ShieldAlert className="h-4 w-4" /> Camera access denied
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Enable camera permission in your browser or device settings and try again.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-3 h-10 w-full rounded-xl bg-gradient-gold text-sm font-semibold text-gold-foreground"
            >
              Retry
            </button>
          </div>
        )}
        {status === "error" && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
            <div className="flex items-center gap-2 font-semibold text-destructive">
              <ShieldAlert className="h-4 w-4" /> Scanner error
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{errorMsg}</p>
          </div>
        )}
      </div>
    </div>
  );
}
