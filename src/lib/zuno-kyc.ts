// Client-side KYC status helper for the ZUNO prototype.
// In production this MUST be mirrored on the backend — every transaction
// endpoint should refuse requests from users whose KYC status !== "verified".

export type KycStatus = "unverified" | "pending" | "verified" | "rejected";

const STATUS_KEY = "zuno_kyc_status";
const DRAFT_KEY = "zuno_kyc_draft";
const INTENT_KEY = "zuno_kyc_intent";
const PROMPT_SEEN_KEY = "zuno_kyc_prompt_seen";

function safeWindow(): Window | null {
  return typeof window === "undefined" ? null : window;
}

/**
 * KYC belongs to a person, not to a browser. Every key is namespaced by the
 * signed-in user's id (read from the stored session) so a second account on
 * the same device starts unverified instead of inheriting the first one's status.
 */
function currentUserId(): string {
  const w = safeWindow();
  if (!w) return "anon";
  try {
    const raw = w.localStorage.getItem("zuno_auth_user");
    const id = raw ? (JSON.parse(raw) as { id?: string }).id : undefined;
    return id || "anon";
  } catch {
    return "anon";
  }
}

const scoped = (key: string) => `${key}:${currentUserId()}`;

/** True once this user has already been shown the "verify to get paid" welcome prompt. */
export function hasSeenKycPrompt(): boolean {
  const w = safeWindow();
  if (!w) return true;
  try {
    return w.localStorage.getItem(scoped(PROMPT_SEEN_KEY)) === "1";
  } catch {
    return true;
  }
}

export function markKycPromptSeen() {
  const w = safeWindow();
  if (!w) return;
  try {
    w.localStorage.setItem(scoped(PROMPT_SEEN_KEY), "1");
  } catch {}
}

function storedUser(): { role?: string; kycStatus?: string; phoneVerified?: boolean } | null {
  const w = safeWindow();
  if (!w) return null;
  try {
    const raw = w.localStorage.getItem("zuno_auth_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Seller identity-check status as last reported by the server (refreshed on every app load). */
export function getKycStatus(): KycStatus {
  const v = storedUser()?.kycStatus;
  return v === "verified" || v === "pending" || v === "rejected" ? (v as KycStatus) : "unverified";
}

/**
 * May this person transact? Sellers need an approved KYC; buyers need a verified phone number.
 * This only decides what the UI shows. The API enforces the same rules on every request,
 * so editing browser storage cannot unlock anything real.
 */
export function isKycVerified(): boolean {
  const u = storedUser();
  if (!u) return false;
  if (u.role === "buyer") return Boolean(u.phoneVerified);
  return getKycStatus() === "verified";
}

/** Mock-mode helper only: in real mode the server decides, and `authService.me()` refreshes the value. */
export function setKycStatus(status: KycStatus) {
  const w = safeWindow();
  if (!w) return;
  try {
    const raw = w.localStorage.getItem("zuno_auth_user");
    if (!raw) return;
    const user = JSON.parse(raw);
    user.kycStatus = status;
    w.localStorage.setItem("zuno_auth_user", JSON.stringify(user));
    if (status === "verified") w.sessionStorage.removeItem(scoped(DRAFT_KEY));
    w.dispatchEvent(new Event("zuno:user-updated"));
  } catch {}
}

export function saveKycDraft(data: unknown) {
  const w = safeWindow();
  if (!w) return;
  try {
    w.sessionStorage.setItem(scoped(DRAFT_KEY), JSON.stringify(data));
  } catch {}
}

export function loadKycDraft<T = unknown>(): T | null {
  const w = safeWindow();
  if (!w) return null;
  try {
    const v = w.sessionStorage.getItem(scoped(DRAFT_KEY));
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

export function setKycIntent(path: string) {
  const w = safeWindow();
  if (!w) return;
  try {
    w.sessionStorage.setItem(INTENT_KEY, path);
  } catch {}
}

export function consumeKycIntent(): string | null {
  const w = safeWindow();
  if (!w) return null;
  try {
    const v = w.sessionStorage.getItem(INTENT_KEY);
    if (v) w.sessionStorage.removeItem(INTENT_KEY);
    return v;
  } catch {
    return null;
  }
}

/**
 * Backend-style guard. Any mocked transaction handler should call this
 * before mutating state so a UI bypass still fails loudly.
 */
export function assertKycVerified() {
  if (!isKycVerified()) {
    const err = new Error("KYC_REQUIRED");
    (err as Error & { code?: string }).code = "KYC_REQUIRED";
    throw err;
  }
}
