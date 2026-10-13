# 0001: Modular monolith on PostgreSQL, no Redis, no microservices

Status: accepted · 14 October 2026

## Context

One developer builds and operates this product alone. The MVP plan listed NestJS, Nuxt 3, PostgreSQL and Redis. The earlier storyteller repository used separate NestJS services over TCP.

## Decision

- One NestJS application made of modules: auth, clinic settings, patients, appointments, visits, prescriptions, billing, reports, messaging, AI assistance and audit.
- One PostgreSQL database. Every clinic-owned table carries a `clinic_id`, and row-level security enforces isolation in the database as well as in code.
- No Redis and no message queue in the MVP.
- One Nuxt 3 single-page web app.

## Why

- A single deployable is far cheaper for one person to run than several services.
- Nothing in the MVP needs a queue. WhatsApp reminders are click-to-send, and AI calls run inside a request with a timeout.
- Row-level security limits the damage of a missing filter in application code.

## Alternatives considered

- Microservices over TCP, as in the old repository. Rejected: more moving parts with no load or team-size reason.
- Redis for jobs. Rejected for now. Add it when automatic WhatsApp sending needs retries.
- Separate database per clinic. Rejected: heavy to migrate and operate at hundreds of clinics.

## Consequences

- Modules must keep clear boundaries so a module can be split out later.
- Each database call that touches clinic data runs inside a transaction that sets the clinic for row-level security.
- If automatic messaging is added, introduce a jobs table with idempotency keys before adding new infrastructure.
