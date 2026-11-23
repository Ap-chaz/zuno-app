import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { SiteNav } from "@/components/site/SiteNav";
import { SiteFooter } from "@/components/site/SiteFooter";
import { WhatsAppFloat } from "@/components/site/WhatsAppFloat";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/hooks/useAuth";
import { LanguageProvider } from "@/hooks/useLanguage";
import { isDashboardRoute } from "@/components/zuno/ThemeToggle";
import zunoLogo from "@/assets/zuno-logo-new.png";

// Route prefixes that render their own chrome (PhoneFrame/BottomNav, admin
// shell, auth screens) and should NOT get the marketing SiteNav/SiteFooter.
const APP_PREFIXES = ["/app", "/auth", "/seller", "/admin"];
// Standalone app-native screens (own TopBar/PhoneFrame) that live outside
// those prefixes but still shouldn't get the marketing chrome.
const APP_ROUTES = ["/help"];
function isAppRoute(pathname: string) {
  if (APP_ROUTES.includes(pathname)) return true;
  return APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <p className="eyebrow">404 · lost in transit</p>
        <h1 className="text-display-lg mt-4">This page never arrived.</h1>
        <p className="mt-4 text-muted-foreground">
          The link you followed doesn't map to a route on ZUNO. Head back and we'll get you where you were going.
        </p>
        <Link
          to="/"
          className="mt-8 inline-flex h-11 items-center rounded-[12px] bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90"
        >
          Return home
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <p className="eyebrow">Something interrupted the transfer</p>
        <h1 className="text-heading-lg mt-4">This page didn't load</h1>
        <p className="mt-3 text-muted-foreground">
          Try again — your session and any escrow funds are unaffected.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="inline-flex h-11 items-center rounded-[12px] bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex h-11 items-center rounded-[12px] border border-border bg-surface px-5 text-sm font-semibold text-foreground transition-colors hover:bg-[color-mix(in_oklab,var(--color-surface-2)_60%,transparent)]"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#fbfaf9" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "ZUNO" },
      { title: "ZUNO Escrow — Hold the money. Not the risk." },
      {
        name: "description",
        content:
          "Escrow built for the online marketplace economy. ZUNO holds payments in a segregated account until buyer and seller both confirm the deal.",
      },
      { property: "og:title", content: "ZUNO Escrow — Hold the money. Not the risk." },
      {
        property: "og:description",
        content:
          "Pay sellers you've never met — without the leap of faith. ZUNO holds funds until delivery is confirmed.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://escrowzuno.co.ke/" },
      { property: "og:image", content: "https://escrowzuno.co.ke/og-image.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "ZUNO — Hold the money. Not the risk." },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "ZUNO Escrow — Hold the money. Not the risk." },
      {
        name: "twitter:description",
        content:
          "Pay sellers you've never met — without the leap of faith. ZUNO holds funds until delivery is confirmed.",
      },
      { name: "twitter:image", content: "https://escrowzuno.co.ke/og-image.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.json" },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "icon", href: "/favicon-32.png", type: "image/png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800;1,500&family=JetBrains+Mono:wght@500;600&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{
              var isDashboard=/^\\/(app|seller|admin)(\\/|$)/.test(location.pathname);
              if(!isDashboard)return;
              var t=localStorage.getItem('zuno-theme');
              var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;
              if(d){document.documentElement.classList.add('dark');}
            }catch(e){}})();`,
          }}
        />
        <HeadContent />
      </head>
      <body>
        <div
          id="zuno-splash"
          style={{
            display: "none",
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            alignItems: "center",
            justifyContent: "center",
            background: "var(--background)",
            transition: "opacity 400ms ease",
          }}
        >
          <img
            src={zunoLogo}
            alt="ZUNO"
            width={72}
            height={72}
            style={{ animation: "zuno-pulse 1.6s ease-in-out infinite" }}
          />
        </div>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
              var el = document.getElementById('zuno-splash');
              if (!el) return;
              var isAppRoute = /^\\/(app|auth|seller|admin|share|help)(\\/|$)/.test(location.pathname);
              if (!isAppRoute) return;
              el.style.display = 'flex';
              window.addEventListener('load', function () {
                setTimeout(function () {
                  el.style.opacity = '0';
                  setTimeout(function () { el.style.display = 'none'; }, 400);
                }, 250);
              });
            })();`,
          }}
        />
        {children}
        <Scripts />
      </body>
    </html>
  );
}

/**
 * Dark mode only exists inside the dashboard (/app, /seller, /admin). Every
 * other route — marketing site, /auth, /share, /help — is light-only. This
 * runs on every client-side navigation to enforce that: leaving the
 * dashboard forces light, (re-)entering it restores the saved preference.
 */
function ThemeRouteSync({ pathname }: { pathname: string }) {
  useEffect(() => {
    const root = document.documentElement;
    if (!isDashboardRoute(pathname)) {
      root.classList.remove("dark");
      return;
    }
    const saved = window.localStorage.getItem("zuno-theme");
    const wantsDark = saved
      ? saved === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.toggle("dark", wantsDark);
  }, [pathname]);

  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const showMarketingChrome = !isAppRoute(pathname);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <LanguageProvider>
          <ThemeRouteSync pathname={pathname} />
          {showMarketingChrome ? (
            <div className="flex min-h-screen flex-col">
              <SiteNav />
              <main className="flex-1">
                <Outlet />
              </main>
              <SiteFooter />
              <WhatsAppFloat />
            </div>
          ) : (
            <Outlet />
          )}
          <Toaster position="top-center" richColors closeButton />
        </LanguageProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
