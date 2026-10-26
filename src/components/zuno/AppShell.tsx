import type { ReactNode } from "react";

/**
 * Shared shell for the /app (buyer) and /seller sections.
 *
 * The outer frame is locked to the viewport height (`h-dvh`) and never scrolls
 * itself; only page content scrolls, so the sidebar and each page's
 * <TopBar>/<BottomNav> (position: sticky) stay pinned.
 *
 * Breakpoints
 * - < lg  : single column + bottom tab bar. Column is phone-width on phones
 *           and widens to `max-w-2xl` on tablets (sm+) so portrait tablets
 *           are not a thin strip, but never overflows (`min-w-0`, `w-full`).
 * - lg+   : fixed 240px sidebar + fluid main area. Main content is capped at
 *           64rem (~900px) and centred, so ultra-wide monitors don't stretch it.
 */
export function AppShell({
  children,
  sidebar,
  bottomNav,
}: {
  children: ReactNode;
  sidebar: ReactNode;
  bottomNav: ReactNode;
}) {
  return (
    <div data-app-shell className="flex h-dvh min-h-0 w-full max-w-full flex-col overflow-x-hidden bg-background lg:flex-row">
      <aside className="hidden shrink-0 border-r border-border/40 bg-surface/60 lg:block lg:h-full lg:w-56">
        {sidebar}
      </aside>

      <div className="mx-auto flex min-h-0 w-full min-w-0 max-w-[440px] flex-1 flex-col bg-background sm:max-w-2xl lg:mx-0 lg:max-w-none">
        <div className="mx-auto flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col lg:max-w-[64rem] lg:px-8 lg:py-6 xl:px-10 xl:py-8">
          {children}
        </div>
        <div className="lg:hidden">{bottomNav}</div>
      </div>
    </div>
  );
}
