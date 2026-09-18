<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project verification and public-site scope

- Run `npm run typecheck`, `npm run lint`, and `npm run build`. For production-browser verification, run `npm run start -- --port 3001` after building.
- Verify public pages in English and Arabic at desktop and mobile widths, including RTL, keyboard navigation, reduced motion, framework changes and demo-form validation.
- Mineral Intelligence styles are scoped to `.mineral-site`; the public Arabic font is loaded in the site layout. Preserve the authenticated application's layouts and existing font setup.
- Evidence receipt and re-verification must keep the gap open. Only a successful verification result closes it; operational and readiness changes follow as a separate event. Public sequences and financial figures are illustrative, not real AI or payment approval.
- Check scaled Evidence Thread SVGs visually: normalized `pathLength` animation must not be combined with `non-scaling-stroke`, which can leave false gaps after verification. Patterned paths retain their dash pattern without normalized path-length animation.
- `EvidenceEnvironment` is a non-interactive, assistive-technology-hidden background layer. Pass it the foreground scene's verification state and source/evidence references; never drive its convergence with a separate timer or document receipt. Its texture is static and inspection motion runs only on verification events.
- The homepage art direction is scoped to `.flagship-home`; shared product-page layouts retain their own composition. The public wordmark uses `Wordmark` with `sculpted`, without changing authenticated branding.
- `VazoraMonument` lazy-loads Three.js and shares the hero's verification state. Verify WebGL fallback, context loss/recovery, pause, pointer response, reduced-motion changes and offscreen suspension. Keep the SVG fallback available and dispose GPU resources on unmount; the scene must not require external assets or render continuously while paused/offscreen.
- Review the monument's open, insufficient, re-verifying and joined geometry visually. Verify intermediate closure poses and pause/resume of the geometry, not only DOM state. Motion follows input and verification events rather than ambient floating; source/evidence annotations must remain consistent with the paths in RTL.
- The hero uses a 4.8-second timing profile after the renderer or fallback is ready. Keep the officer's separate timing unchanged. Verify that reporting period and client acknowledgement complete before readiness updates; input entrances and metallic sheen must honor reduced motion and pause controls.
- The Phase 1 demo form validates and acknowledges only. It does not persist requests, send email or arrange bookings.
- If installed Next.js documentation is blocked by ignore rules, use official documentation matching the installed version. Do not change ignore files or permissions to expose it.
- Test browser interactions at the actual viewing URL. The local browser-preview proxy has returned 502 for HMR, preventing dev-mode React hydration, and mismatched forwarded-host/origin headers for Server Actions. Use direct localhost URLs instead; do not weaken origin checks or change locale routing to compensate for proxy failures. Port 3000 serves live development; a production server on port 3001 needs a rebuild/restart after code changes.
