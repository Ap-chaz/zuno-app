/**
 * Centralized runtime configuration.
 *
 * Every environment-dependent value the app needs should be read from here,
 * never directly from `import.meta.env` elsewhere. This keeps env access
 * typed, gives us one place to add validation, and makes it obvious what
 * the app needs configured before it can talk to a real backend.
 *
 * Add new variables to `.env.example` whenever you add one here.
 */

function readBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === "true" || value === "1";
}

export const env = {
  /**
   * Base URL for the backend API INCLUDING the /api prefix, no trailing slash,
   * e.g. https://zuno-api.up.railway.app/api. Empty string in mock mode.
   */
  apiBaseUrl: ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "").replace(/\/+$/, ""),

  /**
   * When true (default in this prototype), all `services/*` calls resolve
   * against local mock data instead of hitting the network. Flip to false
   * (and set VITE_API_BASE_URL) once a real backend is available — no
   * component code needs to change, only the service implementations.
   */
  useMockApi: readBool(import.meta.env.VITE_USE_MOCK_API, true),

  /** Simulated network latency (ms) for the mock adapter, so loading/skeleton states are visible during development. */
  mockLatencyMs: Number(import.meta.env.VITE_MOCK_LATENCY_MS ?? 500),

  /** Timeout (ms) applied to real network requests once a backend is connected. */
  apiTimeoutMs: Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 15_000),

  appEnv: (import.meta.env.VITE_APP_ENV ?? import.meta.env.MODE ?? "development") as
    | "development"
    | "staging"
    | "production",

  isProd: import.meta.env.PROD,
} as const;

if (typeof window !== "undefined" && env.isProd && env.useMockApi && env.appEnv === "production") {
  // Not fatal: the marketing site is served from this same build. But a production
  // APP build running on mock data must never be mistaken for a real deployment.
  console.warn("[ZUNO] Mock API is enabled in a production build (VITE_USE_MOCK_API).");
}
