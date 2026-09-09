# VAZORA — Phase 1 Plan

## 1. Existing state

No VAZORA repository existed. The environment was empty, so Phase 1 starts from a fresh
Next.js 16 (App Router, TypeScript, Tailwind v4) scaffold. Nothing to preserve.

## 2. Architecture (modular monolith)

```
src/
  app/[locale]/            Next.js routes (en | ar), root layout sets <html lang dir>
    (site)/                Public website: /, /contract-intelligence, /assessor, /demo, /login
    app/                   Authenticated SaaS shell: dashboard, contracts, contracts/[id]/*, evidence, claims, agent
  proxy.ts                 next-intl locale routing + demo-session gate for /app
  i18n/                    routing.ts · request.ts · navigation.ts (Link, useRouter, usePathname)
  messages/                en.json · ar.json (single source of UI copy, ICU syntax)
  components/
    brand/                 Mark, Wordmark
    ui/                    Design-system primitives (Button, Surface, StatusPill, Progress, Table, Tabs, Field…)
    site/                  Nav, Footer, LanguageSwitcher, homepage sections, SignatureAnimation
    app/                   Sidebar, Topbar, health indicators, obligation tables, Officer feed
  domain/                  Entity types + enums (Organization → Project → Contract → Obligation → Evidence → Claim …)
  data/                    Repository interfaces · mock provider (demo org) · Supabase adapter stub
  ai/                      AIProvider interface · provider registry · mock provider (no vendor lock-in)
  lib/                     cn(), locale-aware number/date formatting, misc utilities
supabase/migrations/       Draft SQL for the multi-tenant schema (not executed in Phase 1)
```

Layering: UI → domain/services → data repositories → (mock | Supabase). AI code lives only in
`src/ai` and is called from server code, never from UI components.

Auth in Phase 1: "Enter VAZORA" creates a demo session cookie; `/app/*` is gated by the proxy.
The `AuthProvider` interface is shaped for Supabase Auth so the swap is local to `src/data`.

## 3. Sitemap

Public: `/` · `/contract-intelligence` · `/assessor` · `/demo` · `/login`
App: `/app` → `/app/dashboard` · `/app/contracts` · `/app/contracts/[id]` (+ obligations, evidence, risks,
claims, activity, officer) · `/app/evidence` · `/app/claims` · `/app/agent`
All routes exist under `/en/...` and `/ar/...`; the switcher keeps the current path.

## 4. Visual direction

- Ink-dark public site (`#0A0D12` base, layered graphite surfaces), light "paper" theme for the app —
  same semantic tokens, two themes.
- Single accent: **Verdigris** (teal-green, `#2FBFA0` dark / `#0E8C76` light). No purple, no blue-everything,
  gradients only as faint atmospheric light.
- Status system is separate from brand: Verified (green), Partial (amber), Missing (red), At-risk (orange),
  Pending (neutral).
- Type: Instrument Sans (Latin), IBM Plex Sans Arabic (Arabic), Geist Mono for clause refs, figures and labels.
- Mark: two converging strokes forming a V; the right stroke terminates in a signal node — convergence,
  verification, intelligence flowing inward. Wordmark is tracked-out uppercase.
- Geometry: thin 1px borders, 6–12px radii, hairline grids, node/edge "trace" lines connecting
  requirement → evidence → verification.

## 5. Design system

Tokens (CSS vars via Tailwind v4 `@theme`): color (bg, surface-1/2/3, border, fg, fg-muted, accent, status),
spacing scale, radius (sm 6 / md 10 / lg 14), shadows (subtle), motion (durations 150/300/600, ease-out-quart).
Primitives: Button (primary/secondary/ghost, sizes), Surface/Card, StatusPill, Progress (bar + ring),
Stat, Table, Tabs, Field/Input/Select/Textarea, Kbd, Divider, SectionHeading, Eyebrow.
All layout uses logical properties (`ps/pe/ms/me/start/end/text-start`) so RTL mirrors without overrides;
directional icons flip with `rtl:-scale-x-100`.

## 6. Motion

- Signature hero animation (≈12s loop, motion/react): contract page → clauses recognized → obligations →
  evidence links → verified / missing / at-risk → Claim Readiness 81% → Contract Officer notice.
- Scroll choreography with `whileInView`, subtle parallax on product visuals, micro-interactions on
  status changes. `prefers-reduced-motion` respected. No GSAP/WebGL.

## 7. Localization

next-intl with `/en` and `/ar` prefixes, `hasLocale` validation, `<html dir>` from locale.
Arabic: business Saudi Arabic copy, Latin digits (`numberingSystem: latn`) for figures, locale-aware dates.
Demo entity names are bilingual objects resolved per locale.

## 8. Phase 1 implements

Deliverables 1–26 from the brief: brand, design system, homepage (11 sections + signature animation),
Contract Intelligence and Assessor pages, Book a Demo, Login/Enter, app shell (dashboard, contracts,
contract workspace with 7 tabs, evidence, claims, AI Contract Officer), domain + repository + AI
abstractions, Supabase schema draft, full EN/AR with RTL and a language switcher.

Explicitly out of scope: real AI extraction, real auth/DB, payments, integrations, Assessor product UI.
