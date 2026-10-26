import { jsPDF } from "jspdf";
import { toast } from "sonner";
import zunoLogo from "@/assets/zuno-logo-new.png";

/**
 * Shared receipt builder used by both the buyer receipt (app.transaction.$id)
 * and the seller payout receipt (seller.deliveries). Renders a single receipt
 * design onto an offscreen canvas, then exports it as a real PDF file via
 * jsPDF — so "Download" always produces an actual downloaded file, never the
 * browser print dialog, and looks the same on every screen size.
 */

export interface ReceiptRow {
  label: string;
  value: string;
}

export interface ReceiptData {
  id: string;
  kind: "payment" | "payout";
  dateLabel: string;
  greetingName?: string;
  rows: ReceiptRow[];
  totalLabel: string;
  totalValue: string;
  note?: string;
}

const GOLD_1 = "#ecbb63";
const GOLD_2 = "#cf8a3c";
const INK = "#141a29";
const MUTED = "#6b7280";
const LIGHT_MUTED = "#9aa1af";
const BORDER = "#e8e9ec";
const ACCENT = "#5b3fc4";
const BANNER_INK = "#241a08";

const SCALE = 2;
const CARD_W = 360 * SCALE;
const PAD = 26 * SCALE;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  // Break words that are wider than the column on their own (long IDs, ISO
  // timestamps, references) so they never run past the card edge.
  const words: string[] = [];
  for (const word of text.split(" ")) {
    if (ctx.measureText(word).width <= maxWidth) {
      words.push(word);
      continue;
    }
    let chunk = "";
    for (const ch of word) {
      if (chunk && ctx.measureText(chunk + ch).width > maxWidth) {
        words.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    if (chunk) words.push(chunk);
  }
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const FONT = "'Plus Jakarta Sans', 'Segoe UI', -apple-system, sans-serif";

function measure(ctx: CanvasRenderingContext2D, data: ReceiptData) {
  ctx.font = `500 ${10.5 * SCALE}px ${FONT}`;
  const noteLines = data.note ? wrapText(ctx, data.note, CARD_W - PAD * 2) : [];

  const logoH = 100 * SCALE;
  const greetingH = data.greetingName ? 70 * SCALE : 8 * SCALE;
  const summaryH = data.rows.length * (30 * SCALE) + 14 * SCALE; // right column drives height
  const noteH = noteLines.length ? noteLines.length * (16 * SCALE) + 14 * SCALE : 0;
  const footerH = 100 * SCALE;

  const height =
    48 * SCALE + // top padding
    logoH +
    36 * SCALE + // gap
    greetingH +
    summaryH +
    noteH +
    36 * SCALE + // gap before footer
    footerH;

  return { height: Math.ceil(height), noteLines };
}

async function renderCanvas(data: ReceiptData): Promise<HTMLCanvasElement> {
  const logo = await loadImage(zunoLogo);

  // Scratch context purely for measuring text before we know the final height.
  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d")!;
  const { height, noteLines } = measure(measureCtx, data);

  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  // Flat, sharp-cornered receipt — no outer rounding.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CARD_W, height);

  let y = 48 * SCALE;

  // --- Big centered logo, the receipt's one hero mark ---
  const logoH = 64 * SCALE;
  if (logo) {
    const logoW = (logo.width / logo.height) * logoH;
    ctx.drawImage(logo, CARD_W / 2 - logoW / 2, y, logoW, logoH);
  } else {
    ctx.fillStyle = INK;
    ctx.font = `800 ${36 * SCALE}px ${FONT}`;
    const label = "ZUNO";
    ctx.fillText(label, CARD_W / 2 - ctx.measureText(label).width / 2, y + logoH * 0.75);
  }
  y += 100 * SCALE;

  // --- Greeting ---
  if (data.greetingName) {
    ctx.fillStyle = ACCENT;
    ctx.font = `800 ${20 * SCALE}px ${FONT}`;
    const headline = `Hi ${data.greetingName},`;
    ctx.fillText(headline, CARD_W / 2 - ctx.measureText(headline).width / 2, y);
    y += 28 * SCALE;
    ctx.fillStyle = MUTED;
    ctx.font = `500 ${12.5 * SCALE}px ${FONT}`;
    const sub =
      data.kind === "payment"
        ? "Thank you for paying safely with ZUNO."
        : "Thank you for selling safely with ZUNO.";
    ctx.fillText(sub, CARD_W / 2 - ctx.measureText(sub).width / 2, y);
    y += 42 * SCALE;
  } else {
    y += 8 * SCALE;
  }

  // --- Two-column summary: amount box (left) + detail list (right) ---
  const colGutter = 16 * SCALE;
  const leftW = (CARD_W - PAD * 2) * 0.42;
  const rightX = PAD + leftW + colGutter;
  const rightW = CARD_W - PAD - rightX;
  const summaryTop = y;

  // Right column: stacked "Label   Value" rows.
  let rowY = summaryTop + 16 * SCALE;
  for (const row of data.rows) {
    ctx.fillStyle = MUTED;
    ctx.font = `500 ${10.5 * SCALE}px ${FONT}`;
    ctx.fillText(row.label, rightX, rowY);
    ctx.fillStyle = INK;
    ctx.font = `700 ${11 * SCALE}px ${FONT}`;
    const labelW = Math.max(ctx.measureText(row.label).width, 0);
    ctx.font = `500 ${10.5 * SCALE}px ${FONT}`;
    const gapAfterLabel = 6 * SCALE;
    ctx.font = `700 ${11 * SCALE}px ${FONT}`;
    const valueLines = wrapText(ctx, row.value, rightW - labelW - gapAfterLabel);
    if (valueLines.length <= 1) {
      ctx.fillText(row.value, rightX + labelW + gapAfterLabel, rowY);
      rowY += 30 * SCALE;
    } else {
      let vy = rowY;
      for (const line of valueLines) {
        ctx.fillText(line, rightX + labelW + gapAfterLabel, vy);
        vy += 15 * SCALE;
      }
      rowY = vy + 15 * SCALE;
    }
  }
  const rightColBottom = rowY;

  // Left column: solid amount box.
  const leftH = 132 * SCALE;
  const leftGrad = ctx.createLinearGradient(PAD, summaryTop, PAD + leftW, summaryTop + leftH);
  leftGrad.addColorStop(0, GOLD_1);
  leftGrad.addColorStop(1, GOLD_2);
  ctx.fillStyle = leftGrad;
  ctx.fillRect(PAD, summaryTop, leftW, leftH);

  ctx.fillStyle = BANNER_INK;
  ctx.globalAlpha = 0.75;
  ctx.font = `700 ${9.5 * SCALE}px ${FONT}`;
  const totalLines = wrapText(ctx, data.totalLabel.toUpperCase(), leftW - 24 * SCALE);
  let tly = summaryTop + 24 * SCALE;
  for (const line of totalLines) {
    ctx.fillText(line, PAD + 12 * SCALE, tly);
    tly += 13 * SCALE;
  }
  ctx.globalAlpha = 1;

  ctx.font = `800 ${18 * SCALE}px ${FONT}`;
  const amountLines = wrapText(ctx, data.totalValue, leftW - 24 * SCALE);
  let aly = summaryTop + leftH - (amountLines.length > 1 ? 44 : 34) * SCALE;
  for (const line of amountLines) {
    ctx.fillText(line, PAD + 12 * SCALE, aly);
    aly += 22 * SCALE;
  }

  y = Math.max(rightColBottom, summaryTop + leftH) + 8 * SCALE;

  // --- Note ---
  if (noteLines.length) {
    y += 10 * SCALE;
    ctx.fillStyle = LIGHT_MUTED;
    ctx.font = `500 ${10 * SCALE}px ${FONT}`;
    for (const line of noteLines) {
      ctx.fillText(line, PAD, y);
      y += 16 * SCALE;
    }
  }

  y += 32 * SCALE;

  // --- Footer ---
  ctx.fillStyle = MUTED;
  ctx.font = `500 ${10.5 * SCALE}px ${FONT}`;
  const questionLine = "Questions or feedback? We're here to help.";
  ctx.fillText(questionLine, CARD_W / 2 - ctx.measureText(questionLine).width / 2, y);
  y += 24 * SCALE;

  ctx.fillStyle = INK;
  ctx.font = `800 ${13 * SCALE}px ${FONT}`;
  const brandLine = "ZUNO";
  ctx.fillText(brandLine, CARD_W / 2 - ctx.measureText(brandLine).width / 2, y);
  y += 20 * SCALE;

  ctx.fillStyle = LIGHT_MUTED;
  ctx.font = `500 ${9.5 * SCALE}px ${FONT}`;
  const tagline = "Escrow. Trusted. Secured.";
  ctx.fillText(tagline, CARD_W / 2 - ctx.measureText(tagline).width / 2, y);

  y += 24 * SCALE;
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1 * SCALE;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(CARD_W - PAD, y);
  ctx.stroke();

  return canvas;
}

async function buildPdfBlob(data: ReceiptData): Promise<{ blob: Blob; canvas: HTMLCanvasElement }> {
  const canvas = await renderCanvas(data);
  const imgData = canvas.toDataURL("image/png", 1.0);

  const pxToMm = 25.4 / 96;
  const pdfW = (canvas.width / SCALE) * pxToMm;
  const pdfH = (canvas.height / SCALE) * pxToMm;

  const pdf = new jsPDF({
    unit: "mm",
    format: [pdfW, pdfH],
  });
  pdf.addImage(imgData, "PNG", 0, 0, pdfW, pdfH, undefined, "FAST");
  const blob = pdf.output("blob");
  return { blob, canvas };
}

function filenameFor(data: ReceiptData) {
  return `ZUNO-Receipt-${data.id}.pdf`;
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Instagram, Facebook, TikTok and similar in-app browsers deliberately block
 * `<a download>` — it fails silently with no error to catch. Their one
 * reliable escape hatch is the native OS share sheet, so we detect these
 * webviews and route "download" through Share instead. */
function isInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Instagram|FBAN|FBAV|FB_IAB|Line\/|MicroMessenger|TikTok|Snapchat/i.test(
    navigator.userAgent || "",
  );
}

async function tryNativeShare(
  blob: Blob,
  filename: string,
  id: string,
): Promise<"shared" | "cancelled" | "unsupported"> {
  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
  };

  try {
    const file = new File([blob], filename, { type: "application/pdf" });
    if (nav.canShare?.({ files: [file] }) && nav.share) {
      await nav.share({ files: [file], title: filename, text: `ZUNO receipt #${id}` });
      return "shared";
    }
    if (nav.share) {
      await nav.share({ title: filename, text: `ZUNO receipt #${id}` });
      return "shared";
    }
    return "unsupported";
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
    return "unsupported";
  }
}

/** Generates the receipt PDF and downloads it directly — no popup window,
 * no print dialog. Works the same on mobile and desktop. Inside in-app
 * browsers (Instagram, Facebook, TikTok…) where downloads are blocked, this
 * falls back to the native share sheet automatically. */
export async function downloadReceipt(data: ReceiptData): Promise<void> {
  try {
    const { blob } = await buildPdfBlob(data);
    const filename = filenameFor(data);

    if (isInAppBrowser()) {
      const result = await tryNativeShare(blob, filename, data.id);
      if (result === "shared" || result === "cancelled") return;
      toast.info(
        'Downloads are blocked inside this app. Tap the ⋯ menu and choose "Open in Browser", then try again.',
      );
      return;
    }

    triggerBlobDownload(blob, filename);
  } catch {
    toast.error("Couldn't generate the receipt. Please try again.");
  }
}

/** Shares the receipt PDF via the native share sheet when available (mobile
 * Safari/Chrome), otherwise falls back to a plain download. */
export async function shareReceipt(data: ReceiptData): Promise<void> {
  try {
    const { blob } = await buildPdfBlob(data);
    const filename = filenameFor(data);
    const result = await tryNativeShare(blob, filename, data.id);
    if (result === "shared" || result === "cancelled") return;

    if (isInAppBrowser()) {
      toast.info(
        'Sharing isn\'t available here. Tap the ⋯ menu and choose "Open in Browser", then try again.',
      );
      return;
    }

    triggerBlobDownload(blob, filename);
    toast.info("Sharing isn't supported on this browser — downloaded the receipt instead.");
  } catch {
    toast.error("Couldn't share the receipt. Please try again.");
  }
}

/** Renders the receipt as a PNG data URL for on-screen preview (used by the
 * receipt view before the user chooses to download or share). */
export async function getReceiptImageDataUrl(data: ReceiptData): Promise<string> {
  const canvas = await renderCanvas(data);
  return canvas.toDataURL("image/png", 1.0);
}
