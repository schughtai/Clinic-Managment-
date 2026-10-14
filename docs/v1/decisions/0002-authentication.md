# 0002: Phone number and password sign-in with secure cookie sessions

Status: accepted · 14 October 2026

## Context

The MVP plan called for phone sign-in with a one-time code. That needs an SMS provider that does not exist yet. The old repository used Google sign-in and passed the token in the web address.

## Decision

- Staff sign in with phone number and password. Passwords are hashed with bcrypt.
- The session is a signed token in an httpOnly cookie with SameSite set, and the Secure flag in production. No token ever appears in a web address.
- Unsafe requests must come from an allowed origin.
- Login attempts are rate limited per address and per phone number.
- One-time code sign-in is deferred until an SMS provider is chosen.

## Why

- A working sign-in today beats a perfect one that is blocked on a vendor.
- httpOnly cookies keep the token away from page scripts.

## Consequences

- Passwords can be forgotten. The owner can reset a staff member's password. Owner password reset needs an out-of-band step that is not built yet.
- Moving to one-time codes later means adding a provider interface and a challenge table, not rewriting sessions.

## Roles

Owner, doctor and receptionist. Authorization is checked on the server for every endpoint through a role guard.
