import { env } from "@/config/env";
import type { PaginatedResult } from "@/types/models";

/**
 * Normalized error shape thrown by both the real HTTP client and the mock
 * adapter, so calling code (React Query, components) only ever has to
 * handle one error type regardless of which backend is active.
 */
export class ApiError extends Error {
  status: number;
  code?: string;
  /** Extra fields the API sent with the error (e.g. the phone to verify). */
  data?: Record<string, unknown>;

  constructor(message: string, status = 0, code?: string, data?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

/** Fired when the API says the session is no longer valid, so the app can sign out and redirect. */
export const UNAUTHORIZED_EVENT = "zuno:unauthorized";

function authHeader(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const token = window.localStorage.getItem("zuno_auth_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.apiTimeoutMs ?? 15_000);

  try {
    const res = await fetch(`${env.apiBaseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...authHeader(),
        ...init.headers,
      },
    });

    if (!res.ok) {
      let message = res.statusText || "Request failed";
      let code: string | undefined;
      let extra: Record<string, unknown> | undefined;
      try {
        const body = await res.json();
        extra = body;
        // The API answers `{ error, message, code, status }`; `error` is a string.
        // Also tolerate a nested `{ error: { message, code } }` shape.
        message =
          body?.message ??
          (typeof body?.error === "string" ? body.error : body?.error?.message) ??
          message;
        code = body?.code ?? body?.error?.code;
      } catch {
        // Non-JSON error body — fall back to statusText.
      }
      // An expired/invalid session on an authenticated call: tell the app to sign out.
      // Login/register/OTP calls legitimately return 401/403 for bad input, so skip those.
      if (res.status === 401 && !path.startsWith("/auth/")) {
        if (typeof window !== "undefined") window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
      }
      throw new ApiError(message, res.status, code, extra);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError("Request timed out. Check your connection and try again.", 0, "TIMEOUT");
    }
    throw new ApiError(
      err instanceof Error ? err.message : "Network error. Please try again.",
      0,
      "NETWORK_ERROR",
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Walks every page of a paginated list endpoint and returns the combined
 * result. `basePath` may already contain query params (e.g. filters) —
 * `page`/`pageSize` are appended safely either way.
 *
 * Stops once a page comes back short of `pageSize`, or once we've collected
 * `total` items — whichever the backend tells us first. This exists because
 * every list-backed service was previously requesting a single page
 * (`?pageSize=100`) and treating it as the full result, silently dropping
 * anything past record 100.
 */
async function getAllPages<T>(basePath: string, pageSize = 100): Promise<T[]> {
  const results: T[] = [];
  let page = 1;

  while (true) {
    const separator = basePath.includes("?") ? "&" : "?";
    const res = await request<PaginatedResult<T>>(
      `${basePath}${separator}page=${page}&pageSize=${pageSize}`,
      { method: "GET" },
    );
    const rows = Array.isArray(res?.data) ? res.data : [];
    results.push(...rows);

    const fetchedSoFar = results.length;
    if (rows.length < pageSize || fetchedSoFar >= (res?.total ?? 0)) break;
    page += 1;
  }

  return results;
}

/**
 * Thin REST client. Only used once `env.useMockApi` is false. Every method
 * mirrors the mock adapter's async signature so services don't need an
 * `if (mock)` branch anywhere except in their own `index.ts`.
 */
export const apiClient = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  /** GET a non-paginated list: the API answers `{ <key>: [...] }`. */
  getList: async <T>(path: string, key: string): Promise<T[]> => {
    const res = await request<Record<string, unknown>>(path, { method: "GET" });
    const rows = res?.[key];
    return Array.isArray(rows) ? (rows as T[]) : [];
  },
  /** POST multipart/form-data (file uploads). Lets the browser set the boundary header. */
  postForm: async <T>(path: string, form: FormData): Promise<T> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.apiTimeoutMs * 4);
    try {
      const res = await fetch(`${env.apiBaseUrl}${path}`, {
        method: "POST",
        body: form,
        signal: controller.signal,
        headers: { ...authHeader() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          body?.message ?? (typeof body?.error === "string" ? body.error : body?.error?.message) ?? res.statusText;
        throw new ApiError(message || "Upload failed", res.status, body?.code);
      }
      return body as T;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError("Upload failed. Check your connection and try again.", 0, "NETWORK_ERROR");
    } finally {
      clearTimeout(timeout);
    }
  },
  getAllPages,
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

/** Friendly message from any thrown value (ApiError carries the server's text). */
export function errorMessage(e: unknown, fallback = "Something went wrong. Please try again."): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
