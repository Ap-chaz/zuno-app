import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";
import { useSeller, useSellerPicker } from "@/hooks/queries/useSellers";
import type { Seller } from "@/types/models";

/**
 * Search-as-you-type seller picker for the New Escrow form.
 * Shows at most 10 matches at a time, so it keeps working with thousands of
 * sellers. Lists every active, phone-verified seller (not only the verified
 * directory); verified ones carry a tick. Works with a preset seller id
 * (from /app/new-escrow?seller=...).
 */
export function SellerPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [chosen, setChosen] = useState<Seller | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Wait for a short pause in typing before asking the API.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Close the list when the person taps outside it.
  useEffect(() => {
    const close = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
  }, []);

  const { data: results, isFetching } = useSellerPicker(debounced);
  const { data: fetched, isLoading: loadingSelected, isError: selectedFailed } = useSeller(value || undefined);
  const selected = chosen && chosen.id === value ? chosen : fetched;

  // A preset seller that can't be loaded (not bookable any more) must not stay selected.
  useEffect(() => {
    if (value && selectedFailed) onChange("");
  }, [value, selectedFailed, onChange]);

  useEffect(() => setActive(0), [debounced]);

  const pick = (s: Seller) => {
    setChosen(s);
    onChange(s.id);
    setQuery("");
    setDebounced("");
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const list = results ?? [];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(list.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && open && list[active]) {
      e.preventDefault();
      pick(list[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  // A seller is chosen: show them as a card with a way to change.
  if (value && (selected || loadingSelected)) {
    return (
      <div className="flex h-12 items-center gap-3 rounded-2xl border border-border/60 bg-input px-4">
        {selected ? (
          <>
            <Avatar s={selected} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {selected.name}
              {selected.verified ? <Check className="ml-1 inline h-3.5 w-3.5 text-gold" aria-label="Verified" /> : null}
            </span>
          </>
        ) : (
          <span className="flex flex-1 items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading seller…
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            onChange("");
            setChosen(null);
            setOpen(true);
          }}
          className="shrink-0 text-xs font-semibold text-gold hover:underline"
        >
          Change
        </button>
      </div>
    );
  }

  const list = results ?? [];
  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          role="combobox"
          aria-expanded={open}
          aria-controls="seller-picker-list"
          aria-autocomplete="list"
          autoComplete="off"
          className="h-12 w-full rounded-2xl border border-border/60 bg-input pl-11 pr-10 text-sm outline-none focus:border-gold/50"
          placeholder="Search for the seller by name"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {isFetching && <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>

      {open && (
        <ul
          id="seller-picker-list"
          role="listbox"
          className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-2xl border border-border/60 bg-surface p-1 shadow-card"
        >
          {list.length === 0 && !isFetching && (
            <li className="px-4 py-3 text-sm text-muted-foreground">
              {debounced ? `No seller found for “${debounced}”.` : "No sellers available yet."}
            </li>
          )}
          {list.map((s, i) => (
            <li
              key={s.id}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 ${i === active ? "bg-surface-2" : ""}`}
            >
              <Avatar s={s} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {s.name}
                  {s.verified ? <Check className="ml-1 inline h-3.5 w-3.5 text-gold" aria-label="Verified" /> : null}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {s.deals} completed {s.deals === 1 ? "deal" : "deals"}
                </p>
              </div>
            </li>
          ))}
          {list.length >= 10 && (
            <li className="px-4 py-2 text-[11px] text-muted-foreground">Showing the first 10. Type more of the name to narrow down.</li>
          )}
        </ul>
      )}
    </div>
  );
}

function Avatar({ s }: { s: Seller }) {
  return (
    <span
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
      style={{ backgroundColor: s.color }}
    >
      {s.initials}
    </span>
  );
}
