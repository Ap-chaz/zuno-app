import { useCallback, useSyncExternalStore } from "react";
import { useAuth } from "@/hooks/useAuth";

const KEY_PREFIX = "zuno_hide_balances:";
const EVENT = "zuno-hide-balances-change";
export const MASKED_AMOUNT = "Ksh ••••";

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** Per-account "hide balances" preference, remembered on this browser. */
export function useHideBalances() {
  const { user } = useAuth();
  const key = user?.id ? `${KEY_PREFIX}${user.id}` : null;

  const getSnapshot = useCallback(() => {
    if (!key) return false;
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  }, [key]);

  const hidden = useSyncExternalStore(subscribe, getSnapshot, () => false);

  const setHidden = useCallback(
    (value: boolean) => {
      if (!key) return;
      try {
        localStorage.setItem(key, value ? "1" : "0");
      } catch {
        /* storage blocked: preference just won't persist */
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [key],
  );

  /** Returns the masked text when balances are hidden, otherwise the text unchanged. */
  const mask = useCallback((text: string) => (hidden ? MASKED_AMOUNT : text), [hidden]);

  return { hidden, setHidden, mask };
}
