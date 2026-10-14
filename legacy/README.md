# Legacy v1 code (not built)

This folder holds the v1 clinic code that v2 has not rebuilt yet. Nothing here is part of the npm
workspaces, the build, lint, type check or tests, and no route can reach it.

- `v1-api/`: NestJS modules for patients, appointments, doctors, visits, prescriptions, billing,
  reports, messaging, import/export, AI handwriting reading, files, the old auth, clinic and users
  modules, their tests, the v1 SQL migrations and demo seed.
- `v1-web/`: the v1 Vue 3 web app, including the dictation button and handwriting input.

Why it is kept: features 002 (administrative clinic MVP) and 005 (clinical module) port useful
pieces from here and delete each file once its replacement exists. The last complete v1 commit is
tagged `v1-final`. See `docs/v2/decisions/0010-legacy-v1-code.md`.

`v1-api/modules/data/` was missing from git in v1 because the old `.gitignore` rule `data/` also
matched it; it was recovered from the original working copy.
