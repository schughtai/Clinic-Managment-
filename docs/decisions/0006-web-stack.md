# 0006: Plain Vue and Vite for the web app, not Nuxt

Status: accepted · 14 October 2026

## Context

The MVP plan named Nuxt 3. When dependencies were installed, Nuxt 3's build tooling brought 16 security audit findings, including 2 critical ones in its developer tools, and the fixed releases needed a breaking upgrade. The app is a single-page application behind a sign-in, so it gains little from server-side rendering or file-based server routes.

## Decision

- Vue 3 with Vue Router, built by Vite, as a static single-page app.
- Production serves the built files from any static host or CDN, and sends `/api` requests to the API on the same domain.
- No UI component library. A small stylesheet and a few components keep the bundle small and the screens consistent.

## Why

- Fewer dependencies and a clean audit for everything that ships.
- The built app is plain files, which is the easiest thing for one person to host.
- Nothing in the MVP needs server rendering. Search engines never see the app, because it sits behind sign-in.

## Node version and tooling

- This machine runs Node 20.10. The newest Vite and Vitest need Node 22, so the project uses Vite 6 and Vitest 3, which run on Node 20.
- The remaining audit findings are in Vitest 3 and affect only developers running tests. Nothing from it ships. Move to Vite 7 and Vitest 5 once the team is on Node 22 LTS.

## Consequences

- If search-engine visibility for a public clinic page is ever needed, build it as a separate small site.
- The app is served from the same domain as the API in production, which keeps cookies simple and avoids cross-site settings.
