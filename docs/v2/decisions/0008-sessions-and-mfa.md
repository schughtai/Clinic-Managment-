# 0008: Server-side sessions and authenticator codes

Status: accepted · 14 October 2026 · supersedes the session part of v1 0002

## Decision

- Sessions are random 32-byte tokens in an httpOnly, SameSite=Lax cookie (Secure in production).
  The database stores only a SHA-256 hash, with the person, sign-in level, active organization and
  facility, expiry (12 hours) and revocation time.
- Revocation is immediate: sign-out, password reset, membership deactivation and organization
  suspension end the affected sessions, and every request re-reads the session.
- Super Admins must use a time-based one-time code (RFC 6238, 6 digits, 30 seconds, one step of
  clock drift). Other staff may turn it on. The secret is encrypted with AES-256-GCM using
  `MFA_ENCRYPTION_KEY`; reused codes are refused; ten single-use recovery codes are issued.
- Invitation and reset tokens are also random, stored hashed, single-use and expiring, and travel
  in the URL fragment so they never reach server logs.

## Why

Signed stateless tokens could not end one device's session or change organization context
without re-issuing tokens. A session lookup per request was already happening in v1.
