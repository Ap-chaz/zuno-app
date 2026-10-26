import { apiClient, ApiError } from "@/lib/api/client";
import { mockResolve, mockReject } from "@/lib/api/mock-adapter";
import { env } from "@/config/env";
import { mapUser, mapKycStatus } from "@/lib/api/mappers";
import type { AuthSession, User, ZunoRole } from "@/types/models";

const TOKEN_KEY = "zuno_auth_token";
const USER_KEY = "zuno_auth_user";
// Deliberately separate from the active session keys above: a normal
// logout clears TOKEN_KEY/USER_KEY, but biometric login needs something to
// restore even after that — this snapshot is only cleared when the person
// explicitly turns biometric login off (or logs out "everywhere").
const BIOMETRIC_TOKEN_KEY = "zuno_biometric_token";
const BIOMETRIC_USER_KEY = "zuno_biometric_user";

export interface LoginInput {
  identifier: string; // email or phone
  password: string;
}

export interface SignupInput {
  name: string;
  email: string;
  phone: string;
  password: string;
  role: ZunoRole;
}

function persistSession(session: AuthSession) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, session.token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(session.user));
}

function clearSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}

function saveBiometricSession(session: AuthSession) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BIOMETRIC_TOKEN_KEY, session.token);
  window.localStorage.setItem(BIOMETRIC_USER_KEY, JSON.stringify(session.user));
}

function getBiometricSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    const token = window.localStorage.getItem(BIOMETRIC_TOKEN_KEY);
    const rawUser = window.localStorage.getItem(BIOMETRIC_USER_KEY);
    if (!token || !rawUser) return null;
    return { token, user: JSON.parse(rawUser) as User };
  } catch {
    return null;
  }
}

function clearBiometricSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(BIOMETRIC_TOKEN_KEY);
  window.localStorage.removeItem(BIOMETRIC_USER_KEY);
}

const MOCK_ACCOUNTS_KEY = "zuno_mock_accounts";

function readMockAccounts(): Record<string, User> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(MOCK_ACCOUNTS_KEY) ?? "{}") as Record<string, User>;
  } catch {
    return {};
  }
}

function saveMockAccount(user: User) {
  if (typeof window === "undefined") return;
  const accounts = readMockAccounts();
  if (user.email) accounts[user.email.trim().toLowerCase()] = user;
  if (user.phone) accounts[user.phone.trim()] = user;
  window.localStorage.setItem(MOCK_ACCOUNTS_KEY, JSON.stringify(accounts));
}

function nameFromIdentifier(identifier: string): string {
  const local = identifier.includes("@") ? identifier.split("@")[0] : identifier;
  const words = local.replace(/[._-]+/g, " ").trim();
  return words ? words.replace(/\b\w/g, (c) => c.toUpperCase()) : "ZUNO User";
}

/** Stable per-account id so per-user data (like KYC status) never collides between accounts. */
function idFromIdentifier(identifier: string): string {
  const slug = identifier.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `usr_${slug || Date.now()}`;
}

function mockUser(overrides: Partial<User> = {}): User {
  const base = buildMockUser(overrides);
  return { ...base, avatarInitial: (base.name.trim().charAt(0) || "?").toUpperCase() };
}

function buildMockUser(overrides: Partial<User> = {}): User {
  return {
    id: "usr_demo_001",
    phoneVerified: true,
    sellerTier: 0,
    name: "Alvan Otieno",
    email: "alvan@example.com",
    phone: "+254700000000",
    role: "buyer",
    kycStatus: "unverified",
    trustScore: 850,
    avatarInitial: "A", // overridden below from the real name
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const PENDING_PHONE_KEY = "zuno_pending_phone";
export const USER_UPDATED_EVENT = "zuno:user-updated";

/** The phone number waiting for its SMS code (kept for this tab only). */
export function getPendingPhone(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(PENDING_PHONE_KEY);
  } catch {
    return null;
  }
}
function setPendingPhone(phone: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (phone) window.sessionStorage.setItem(PENDING_PHONE_KEY, phone);
    else window.sessionStorage.removeItem(PENDING_PHONE_KEY);
  } catch {
    /* ignore */
  }
}

/** Merge a change into the stored user and tell the app. Used by `me()` and the mock KYC flow. */
function updateStoredUser(patch: Partial<User>): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const next = { ...(JSON.parse(raw) as User), ...patch };
    window.localStorage.setItem(USER_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(USER_UPDATED_EVENT));
    return next;
  } catch {
    return null;
  }
}

export const authService = {
  async login(input: LoginInput): Promise<AuthSession> {
    if (!input.identifier.trim() || !input.password.trim()) {
      return mockReject("Enter your email/phone and password.", 400, "VALIDATION_ERROR");
    }
    if (env.useMockApi) {
      const id = input.identifier.trim();
      const session: AuthSession = {
        user:
          readMockAccounts()[id.toLowerCase()] ??
          readMockAccounts()[id] ??
          mockUser({
            id: idFromIdentifier(input.identifier),
            email: id.includes("@") ? id : "",
            phone: id.includes("@") ? "" : id,
            name: nameFromIdentifier(input.identifier),
            // Mock only: an email starting with "admin@" gets the admin role so the admin screens can be previewed.
            role: id.toLowerCase().startsWith("admin@") ? "admin" : "buyer",
          }),
        token: `mock-token-${Date.now()}`,
      };
      persistSession(session);
      if (getBiometricSession()) saveBiometricSession(session);
      return mockResolve(session);
    }
    const res = await apiClient.post<{ token: string; user: Record<string, unknown> }>("/auth/login", {
      identifier: input.identifier.trim(),
      password: input.password,
    });
    const session: AuthSession = { token: res.token, user: mapUser(res.user) };
    persistSession(session);
    if (getBiometricSession()) saveBiometricSession(session);
    return session;
  },

  /**
   * Creates the account. Does NOT sign anyone in: the phone must be proven with an SMS code
   * first (`verifyOtp`), which is what returns the session.
   */
  async signup(input: SignupInput): Promise<{ phone: string }> {
    if (!input.name.trim() || !input.password.trim() || !input.phone.trim()) {
      return mockReject("Fill in all required fields.", 400, "VALIDATION_ERROR");
    }
    if (input.role === "admin") return mockReject("Invalid account type.", 400, "VALIDATION_ERROR");
    if (env.useMockApi) {
      const user = mockUser({
        id: idFromIdentifier(input.email || input.phone),
        name: input.name,
        email: input.email,
        phone: input.phone,
        role: input.role,
        phoneVerified: false,
      });
      saveMockAccount(user);
      setPendingPhone(input.phone.trim());
      return mockResolve({ phone: input.phone.trim() });
    }
    await apiClient.post("/auth/register", {
      full_name: input.name.trim(),
      phone_number: input.phone.trim(),
      email: input.email.trim() || undefined,
      password: input.password,
      role: input.role,
    });
    setPendingPhone(input.phone.trim());
    return { phone: input.phone.trim() };
  },

  /** Step 2 of signup (and of a login that found an unverified phone). Returns the signed-in session. */
  async verifyOtp(code: string, phone = getPendingPhone() ?? ""): Promise<AuthSession> {
    if (!phone) return mockReject("Start again from sign up or log in.", 400, "NO_PENDING_PHONE");
    if (env.useMockApi) {
      // Mock: any complete 6-digit code works.
      const user = Object.values(readMockAccounts()).find((u) => u.phone?.trim() === phone);
      if (!user || !/^\d{6}$/.test(code)) return mockReject("Incorrect code.", 400, "OTP_INVALID");
      const session: AuthSession = { user: { ...user, phoneVerified: true }, token: `mock-token-${Date.now()}` };
      saveMockAccount(session.user);
      persistSession(session);
      setPendingPhone(null);
      return mockResolve(session);
    }
    const res = await apiClient.post<{ token: string; user: Record<string, unknown> }>("/auth/verify-otp", {
      phone_number: phone,
      otp_code: code,
    });
    const session: AuthSession = { token: res.token, user: mapUser(res.user) };
    persistSession(session);
    setPendingPhone(null);
    return session;
  },

  async resendOtp(phone = getPendingPhone() ?? ""): Promise<void> {
    if (!phone) return mockReject("Start again from sign up or log in.", 400, "NO_PENDING_PHONE");
    if (env.useMockApi) return mockResolve<void>(undefined);
    await apiClient.post("/auth/send-otp", { phone_number: phone });
  },

  setPendingPhone,
  getPendingPhone,

  /** Seller identity check: uploads the ID photos to the API for admin review. */
  async submitKyc(input: {
    fullName: string;
    idNumber: string;
    dob?: string;
    businessName?: string;
    kraPin?: string;
    idFront: File;
    idBack?: File;
    selfie: File;
  }): Promise<void> {
    if (env.useMockApi) {
      // Mock only: instant approval so the rest of the app can be previewed.
      await mockResolve(undefined);
      updateStoredUser({ kycStatus: "verified", sellerTier: 1 });
      return;
    }
    const form = new FormData();
    form.append("full_name", input.fullName.trim());
    form.append("national_id_number", input.idNumber.trim());
    if (input.dob) form.append("date_of_birth", input.dob);
    if (input.businessName) form.append("business_name", input.businessName);
    if (input.kraPin) form.append("kra_pin", input.kraPin);
    form.append("id_front", input.idFront);
    if (input.idBack) form.append("id_back", input.idBack);
    form.append("selfie", input.selfie);
    await apiClient.postForm("/auth/kyc/submit", form);
    updateStoredUser({ kycStatus: "pending" });
  },

  /** Current review state, including the admin's rejection reason when there is one. */
  async kycStatus(): Promise<{ status: User["kycStatus"]; message: string; rejectionReason?: string; dealLimit?: number }> {
    if (env.useMockApi) {
      const u = authService.getStoredSession()?.user;
      return { status: u?.kycStatus ?? "unverified", message: "" };
    }
    const r = await apiClient.get<Record<string, any>>("/auth/kyc/status"); // eslint-disable-line @typescript-eslint/no-explicit-any
    const status = mapKycStatus(r.kyc_status);
    updateStoredUser({ kycStatus: status, sellerTier: Number(r.seller_tier ?? 0) });
    return { status, message: r.message ?? "", rejectionReason: r.rejection_reason ?? undefined, dealLimit: r.deal_limit };
  },

  /** Re-reads the account from the server (role, KYC, tier...). The server, not this browser, is the source of truth. */
  async me(): Promise<User | null> {
    const session = authService.getStoredSession();
    if (!session) return null;
    if (env.useMockApi) return session.user;
    const res = await apiClient.get<{ user: Record<string, unknown> }>("/auth/profile");
    const user = mapUser(res.user);
    updateStoredUser(user);
    return user;
  },

  updateStoredUser,

  async requestPasswordReset(identifier: string): Promise<{ sent: true }> {
    if (!identifier.trim()) {
      return mockReject("Enter the phone number linked to your account.", 400, "VALIDATION_ERROR");
    }
    if (env.useMockApi) return mockResolve({ sent: true });
    await apiClient.post("/auth/forgot-password", { phone_number: identifier.trim() });
    setPendingPhone(identifier.trim());
    return { sent: true };
  },

  async resetPassword(input: { phone: string; code: string; newPassword: string }): Promise<void> {
    if (env.useMockApi) return mockResolve<void>(undefined);
    await apiClient.post("/auth/reset-password", {
      phone_number: input.phone,
      otp_code: input.code,
      new_password: input.newPassword,
    });
  },

  async logout(): Promise<void> {
    clearSession();
  },

  getStoredSession(): AuthSession | null {
    if (typeof window === "undefined") return null;
    try {
      const token = window.localStorage.getItem(TOKEN_KEY);
      const rawUser = window.localStorage.getItem(USER_KEY);
      if (!token || !rawUser) return null;
      return { token, user: JSON.parse(rawUser) as User };
    } catch {
      return null;
    }
  },

  /** Snapshot used by biometric login — deliberately survives a normal logout. */
  getBiometricSession,
  saveBiometricSession,
  clearBiometricSession,
  /** Re-establishes a session as the active one (sets the normal token/user keys the rest of the app reads). */
  activateSession: persistSession,
};

export { ApiError };
