# VAZORA — Phase 1.5 Visual Redesign Plan

Scope: visual, brand, UX and motion only. No architecture, route, data, auth or localization-system changes.

## 1. Preserved (untouched)

- Next.js 16 App Router, `proxy.ts`, TypeScript, `src/domain`, `src/data/*`, `src/ai/*`, Supabase-ready boundary.
- Routes: `/[locale]`, `/contract-intelligence`, `/assessor`, `/demo`, `/login`, `/app/**`.
- next-intl routing (`en` default, `ar` RTL), `LanguageSwitcher` context preservation, message-catalog architecture (`en.json` / `ar.json`). New copy is added as new keys; existing keys and shapes remain.
- Demo form action + validation/retention, demo login cookie, app shell navigation and every `/app` page's data logic.
- `StatusTone` semantics (verified / partial / missing / at_risk / pending) and `StatusPill` API used by the app.

## 2. Palette (light-first)

| Token | Value | Use |
| --- | --- | --- |
| `--surface-porcelain` | `#F7F7F3` | page default |
| `--surface-mineral` | `#EEF1EF` | alternating calm sections |
| `--surface-canvas` | `#FCFCFA` | bright data canvas (product surfaces) |
| `--surface-ink` | `#111514` / `#171B1A` | one immersive dark section + footer |
| `--line` / `--line-strong` | `#DDE2DE` / `#C7CEC9` | hairlines, metallic-silver feel |
| `--fg` / `--fg-muted` / `--fg-faint` | `#141817` / `#5A625E` / `#8A928D` | text |
| accent (mineral green) | `#1E8A63` (deep `#166E4F`) | verified, active intelligence, primary CTA |
| partial | `#B8862B` | amber, restrained |
| at-risk | `#C2603E` | muted coral |
| missing | `#B8352F` | deep signal red |

Dark section uses inverted fg tokens and a lighter mineral green (`#3FB489`) for contrast. Surface sequence on the homepage: porcelain → mineral → canvas → ink → porcelain.

## 3. Typography

English: Instrument Sans retained; display sizes reduced (hero 2.75–3.5rem, section 2–2.5rem), tracking `-0.02em`, `text-wrap: balance`, measure ≤ 58ch. Geist Mono for clause refs, figures, filenames, timestamps.

Arabic: **Alexandria** (400/500/600/700) replaces IBM Plex Sans Arabic. Independent scale via `[dir="rtl"]`: display 1.4 line-height, body 1.85, headings capped at 24ch to avoid awkward breaks, hero one size smaller than EN, weights 600 for section headings and 700 only for hero/footer statements. Eyebrows are plain text (no tracking / uppercase). Clause numbers, filenames, amounts remain `dir="ltr"` mono.

## 4. Evidence Threads

`components/brand/threads.tsx`: SVG primitives — `Thread` (path with `pathLength` draw-in, tone-colored), `Node` (hairline circle with filled core), `ThreadField` (decorative background of converging paths used in hero/footer). Fine 1px strokes, nodes 6–8px, mineral green for verified connections, missing threads dashed coral. Reduced-motion: rendered fully drawn, no animation. RTL: horizontal mirroring via `insetInlineStart` / scaleX on the SVG.

## 5. Proof Chain

`components/site/home/proof-chain.tsx`: five nodes on one thread — Original Clause → Requirement → Evidence → Verification → Decision — with a real example (clause 12.1 text → requirement → `Performance_Sep.pdf` → four checks → "Partially verified"). Scroll-in draws the thread, the Verification node shows check results, the Decision node explains *why* (2 gaps). Mobile: vertical thread.

## 6. Hero states

Single continuous stage (extends `signature-animation.tsx`), light canvas:

1. Contract document appears (`RTA-OM-2026-014`).
2. Clauses 8.4 / 12.1 / 14.2 illuminate.
3. Clauses separate into obligation rows.
4. Threads connect obligations → evidence (`PM_Log_Aug.xlsx`, `Performance_Sep.pdf`, `Signed_Acceptance.pdf` pending).
5. Verification: VERIFIED / PARTIAL / MISSING.
6. Missing → risk: "Potential exposure SAR 420,000".
7. Officer acts: "Client acknowledgement missing. Requested from project owner."
8. New evidence arrives (`Signed_Acceptance.pdf`), thread reconnects, MISSING → VERIFIED.
9. Claim readiness 73% → 82% → 91%; loop.

Copy: headline "The contract is awarded. Now make sure it gets executed." with eyebrow "VAZORA · Evidence Intelligence" and the parent line kept as the supporting sentence. Reduced motion shows the final state.

## 7. Homepage narrative (section by section)

1. Hero (porcelain) — two-column, animation dominant.
2. Execution gap (porcelain) — three points as an editorial numbered list, no cards.
3. Proof Chain (mineral) — signature diagram.
4. Lifecycle (mineral→canvas) — horizontal timeline with thread, 8 stages, Award highlighted.
5. Evidence quality (canvas) — floating verification panel, file vs. clause checks.
6. AI Contract Officer (**ink, immersive**) — timestamped activity stream 08:14 → 09:45 → VERIFIED; no chat metaphor.
7. Claim Readiness (porcelain, large data moment) — CLAIM #05, SAR 1,850,000, 82%, 12 requirements 9/2/1, blocking reasons mapped to 14.2 / 8.4.
8. Assessor ecosystem (mineral) — central VAZORA ASSESSOR node, selectable frameworks changing evidence types (client component), "One intelligence engine. Many specialized assessors." Provider portfolio shown as *future vision* with illustrative figures and the human-oversight note.
9. Foundation (porcelain) — four trust items as a hairline table.
10. Closing CTA + footer (ink) — threads converge into "VAZORA / Evidence Intelligence / From requirements to verified reality."

Cards reduced from ~30 bordered boxes to a handful of product surfaces.

## 8. Arabic-specific treatment

Own type scale and rhythm (above); mirrored threads and timelines via logical properties; numerals/files/clauses kept LTR mono inside RTL text; hero headline composed for Arabic ("العقد تمت ترسيته. الآن تأكد من تنفيذه."); Arabic eyebrows as plain labels; footer statement uses Alexandria 700; officer stream timestamps stay LTR.

## 9. Header / footer / pages

- Header: light, hairline, wordmark + evolved mark; Products and Platform hover groups (anchors to existing routes), Book a demo primary, Enter VAZORA text, small language switch.
- Footer: ink, thread field, closing statement, restrained columns.
- Contract Intelligence: light hero, capabilities as an editorial two-column list, workspace preview elevated on canvas, FAQ kept.
- Assessor: shared interactive framework component + planned assessors as hairline list.
- Demo: two columns — 5-step demo flow with thread on the left, form on a canvas surface.
- Login: light panel.

## 10. App shell

Token inheritance only: light porcelain surfaces, new status colors, `Panel`/`Table` hairlines, active nav mineral-green indicator, `StatusPill` unchanged in API. No layout rebuild.

## 11. Mobile / motion

Stage animation keeps fixed ratio; officer stream and proof chain go vertical; hero headline ≤ 2.25rem; thread fields hidden below `sm`. Motion via CSS + `motion/react` only; all sequences gated by `useReducedMotionSafe`; no bounce, no blobs, reveals limited to section-level.
