# 0005: Embedded PostgreSQL for development and tests

Status: accepted · 14 October 2026

## Context

Docker is installed on the developer's machine but its engine was not running, and no local PostgreSQL exists. The app needs a real PostgreSQL because it relies on row-level security.

## Decision

- Development and automated tests use the `embedded-postgres` package, which downloads and runs a real PostgreSQL server from npm with no installation.
- Production uses any managed PostgreSQL through two connection strings: an administrator URL for migrations and an application URL for a restricted role.
- Migrations are plain SQL files applied in order and recorded in a table.

## Why

Row-level security is a core safety feature, so tests must run on the real database engine, not an emulation.

## Consequences

- The first run downloads the PostgreSQL binary.
- The embedded package is marked beta upstream. It is used only for development and tests, never in production.
- The application role must not be a superuser, since superusers bypass row-level security. Migrations create it.
