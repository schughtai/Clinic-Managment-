# 0010: v1 domain code kept unbuilt in legacy/

Status: accepted · 14 October 2026

## Decision

The v1 modules that feature 001 does not rebuild move to `legacy/` outside the build. Feature 002
ports patients, appointments, billing, reports, messaging and import/export; feature 005 ports
visits, prescriptions and AI handwriting behind the clinical module. Each port deletes the legacy
file it replaces. The last complete v1 commit is tagged `v1-final`.

## Why

The v1 code targets the removed schema and cannot compile against v2. Keeping it unreachable is
stricter than a module switch, and keeping it readable makes the ports faster.
