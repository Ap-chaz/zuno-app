# ZUNO Escrow

> **Hold the money. Not the risk.**  
> Escrow and buyer protection built for online social commerce in Kenya.

ZUNO provides a secure, neutral escrow platform for peer-to-peer marketplace deals conducted across WhatsApp, Instagram, TikTok, and online classifieds. Funds are held in a segregated account and released only when both buyer and seller confirm delivery and inspection.

---

## Architecture & Tech Stack

### Frontend & Application Shell
* **Core Framework:** [React 19](https://react.dev/) + [TanStack Start](https://tanstack.com/start) (Full-stack SSR with [Nitro](https://nitro.build/))
* **Routing:** [TanStack Router](https://tanstack.com/router) (type-safe, file-based routing in `src/routes/`)
* **Data Fetching & State:** [TanStack Query v5](https://tanstack.com/query) (React Query)
* **Styling & Design System:** [Tailwind CSS v4](https://tailwindcss.com/) with OKLCH color spaces, [Radix UI](https://www.radix-ui.com/) primitives, [Lucide React](https://lucide.dev/) icons
* **Receipts & Exports:** Offscreen Canvas to [jsPDF](https://github.com/parallax/jsPDF) for client-side downloadable PDF receipts

### Companion Backend (`backend` branch)
The full REST API backend lives on the `backend` branch of this repository:
* **Stack:** Python 3.11 + Flask + MySQL
* **Payments:** Safaricom M-Pesa Daraja (STK Push & B2C Payouts)
* **Authentication & SMS:** Phone OTP via Africa's Talking + Flask-JWT-Extended
* **Storage & Scheduling:** Cloudinary (KYC & dispute evidence) + APScheduler (auto-release timer)

---

## Dual-Mode API Integration

ZUNO features a clean service-adapter architecture allowing seamless development with or without an active backend connection:

1. **Mock Mode (`VITE_USE_MOCK_API=true`):**
   * Default setting for local UI development and design testing.
   * Uses local storage and deterministic fixtures with realistic simulated latency (`VITE_MOCK_LATENCY_MS`).
   * Supports full end-to-end simulated flows (creating orders, M-Pesa PIN prompts, dispute mediation, and mock KYC).
   * Any 6-digit OTP code logs in; emails starting with `admin@` grant the admin role.

2. **Production Mode (`VITE_USE_MOCK_API=false`):**
   * Point `VITE_API_BASE_URL` to your live API instance (e.g. deployed on Railway).
   * All authentication, escrow state changes, Safaricom Daraja STK pushes, and dispute actions are validated and authorized server-side.

---

## User Portals & Routing Structure

The application is cleanly partitioned into distinct user roles and public experiences:

* **Public Marketing & Legal (`/`):**
  * Landing page, fee calculator, [How It Works](/how-it-works), [Pricing](/pricing), [Dispute Policy](/dispute-policy), [Terms of Service](/terms), and [Privacy Policy](/privacy).
* **Buyer Portal (`/app`):**
  * Protected deals, active orders, transaction details, M-Pesa STK Push payment screen, delivery tracking, and dispute negotiations.
* **Seller Portal (`/seller`):**
  * Contract requests, fulfillment tracking, payout details, business KYC verification, and customer delivery logs.
* **Admin Portal (`/admin`):**
  * Operational dashboard for manual KYC reviews, dispute adjudication (`REFUND_BUYER`, `RELEASE_TO_SELLER`, `SPLIT`), and payout audits.
* **Authentication (`/auth`):**
  * Mobile phone and password login, SMS OTP verification, password reset, and role onboarding.

---

## Core Escrow Lifecycle

```
[Contract Agreed] ──► [Funded via M-Pesa] ──► [In Transit (Courier)]
                             │
                             ▼
    [Completed] ◄── [Inspection Window] ──► [Disputed]
   (Funds Released)   (Buyer approves)          │
                                                ▼
                                    [Peer Offer / Admin Ruling]
                                    (Refund / Release / Split)
```

### Fee Schedule
Fees are tier-based depending on product verifiability and dispute risk, split **50/50** between buyer and seller:
* **Low Risk (1.0%):** Standardized, easily verifiable items (new electronics, books, media).
* **Medium Risk (1.75%):** General goods (fashion, home goods, used electronics).
* **High Risk (2.5%):** High-value, custom, or dispute-prone items (jewelry, vehicles, deposits, services).

---

## Getting Started

### Prerequisites
* [Node.js](https://nodejs.org/) (v20+ recommended)
* `npm` or `pnpm`

### Installation & Local Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Ap-chaz/zuno-app.git
   cd zuno-app
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env.local
   ```
   *For mock development, the default `.env.example` values work out-of-the-box.*

4. **Start the development server:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Available Scripts

* `npm run dev` — Starts the local Vite dev server with Hot Module Replacement (HMR).
* `npm run build` — Bundles the client and server for production deployment.
* `npm run preview` — Locally previews the production build.
* `npm run lint` — Runs ESLint checks.
* `npm run format` — Formats files with Prettier.

---

## Project Directory Layout

```
src/
├── assets/          # Static brand images, slide graphics, logos
├── components/      # UI components
│   ├── common/      # Error boundaries, card skeletons, state views
│   ├── site/        # Marketing site header, footer, hero rotator
│   ├── ui/          # Radix UI + Tailwind primitive components
│   └── zuno/        # App-specific components (AppShell, PhoneFrame, TopBar, Gates)
├── config/          # Environment configuration loader
├── hooks/           # Custom React hooks & React Query wrappers
│   └── queries/     # Dedicated queries & mutations per domain model
├── lib/             # Utilities, fees, receipt canvas generator, WebAuthn, i18n
│   ├── api/         # HTTP client, mock adapter, and response mappers
│   └── i18n/        # English and Swahili translations
├── routes/          # TanStack Router file-based route definitions
├── services/        # Service layer (auth, transactions, contracts, disputes, admin)
├── types/           # Core domain TypeScript models & status definitions
├── router.tsx       # QueryClient & router factory
├── server.ts        # Nitro SSR entry point & error handler
└── styles.css       # Tailwind CSS v4 design tokens and theme variables
```

---

## License

Private repository. All rights reserved by ZUNO.
