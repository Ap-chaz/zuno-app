// The role comes from the SERVER (it is part of the signed-in user the API returned).
// This file only reads it; there is nothing to "set" any more.
export type ZunoRole = "buyer" | "seller";

function storedRole(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("zuno_auth_user");
    return raw ? ((JSON.parse(raw) as { role?: string }).role ?? null) : null;
  } catch {
    return null;
  }
}

export function getRole(): ZunoRole | null {
  const r = storedRole();
  return r === "buyer" || r === "seller" ? r : null;
}

/** @deprecated The role is chosen at sign-up and stored on the server. Kept so old imports still compile. */
export function setRole(_role: ZunoRole) {}

/** @deprecated See setRole. */
export function clearRole() {}

/** Where each role lands after signing in. */
export function homeFor(role: string | null | undefined): "/seller" | "/app" | "/admin" {
  return role === "seller" ? "/seller" : role === "admin" ? "/admin" : "/app";
}
