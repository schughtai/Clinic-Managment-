# 0009: React and Vite web app served by the API

Status: accepted · 14 October 2026 · supersedes v1 0006

## Decision

- The web app is React 19 with React Router 7 and TanStack Query 5, built by Vite 6. No UI kit;
  design tokens from v2 §17.2 are CSS custom properties and layouts use logical properties so
  Urdu right-to-left works.
- In production the API serves the built files and answers `/api`, so the browser sees one origin
  and session cookies need no cross-site settings. This is one Railway service.
- Versions are chosen to run on Node 20.10 (React Router 7, Vite 6, Vitest 3, jsdom 26).

## Alternatives

Next.js (server rendering adds hosting complexity behind a sign-in), keeping Vue (the product
owner chose React per v2 §10).
