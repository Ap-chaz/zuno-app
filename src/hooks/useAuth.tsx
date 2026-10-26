import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { authService, USER_UPDATED_EVENT, type LoginInput, type SignupInput } from "@/services/auth.service";
import { UNAUTHORIZED_EVENT } from "@/lib/api/client";
import type { AuthSession, User } from "@/types/models";

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (input: LoginInput) => Promise<void>;
  /** Creates the account; the user is signed in only after `verifyOtp`. */
  signup: (input: SignupInput) => Promise<void>;
  verifyOtp: (code: string) => Promise<User>;
  resendOtp: () => Promise<void>;
  /** Re-read role / KYC / tier from the server. */
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
  /** Re-activates a session already stored on this device (used by biometric login) without re-authenticating with a password. */
  restoreSession: () => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const session = authService.getStoredSession();
    setUser(session?.user ?? null);
    setIsLoading(false);
    // Ask the server who we really are (role/KYC/tier may have changed since last visit).
    if (session) {
      authService.me().then((fresh) => fresh && setUser(fresh)).catch(() => {});
    }

    const onUnauthorized = () => {
      authService.logout().then(() => setUser(null));
    };
    const onUserUpdated = () => setUser(authService.getStoredSession()?.user ?? null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    window.addEventListener(USER_UPDATED_EVENT, onUserUpdated);
    return () => {
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
      window.removeEventListener(USER_UPDATED_EVENT, onUserUpdated);
    };
  }, []);

  const handleSession = useCallback((session: AuthSession) => {
    setUser(session.user);
  }, []);

  const login = useCallback(
    async (input: LoginInput) => {
      setError(null);
      setIsLoading(true);
      try {
        const session = await authService.login(input);
        handleSession(session);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to log in. Please try again.");
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [handleSession],
  );

  const signup = useCallback(
    async (input: SignupInput) => {
      setError(null);
      setIsLoading(true);
      try {
        await authService.signup(input);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to create your account. Please try again.");
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [handleSession],
  );

  const verifyOtp = useCallback(
    async (code: string) => {
      const session = await authService.verifyOtp(code);
      handleSession(session);
      return session.user;
    },
    [handleSession],
  );

  const resendOtp = useCallback(() => authService.resendOtp(), []);

  const refresh = useCallback(async () => {
    const fresh = await authService.me();
    if (fresh) setUser(fresh);
  }, []);

  const logout = useCallback(async () => {
    await authService.logout();
    setUser(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const restoreSession = useCallback(() => {
    const session = authService.getBiometricSession();
    if (!session) return false;
    authService.activateSession(session);
    setUser(session.user);
    return true;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: user !== null,
      isLoading,
      error,
      login,
      signup,
      verifyOtp,
      resendOtp,
      refresh,
      logout,
      clearError,
      restoreSession,
    }),
    [user, isLoading, error, login, signup, verifyOtp, resendOtp, refresh, logout, clearError, restoreSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
