---
name: skill-library
description: Router for this project's ECC skill surface — which ecc:* skills load every session (DAILY) vs. which stay searchable on demand (LIBRARY). Not a skill to invoke directly; read it to decide what to load.
---

# EvAcChargeTimer skill surface

Built by `ecc:agent-sort` against the actual stack: Next.js 16 (App Router,
Turbopack) + React 19 + TypeScript, Tailwind CSS 4, Supabase Postgres (RLS,
Realtime, self-hosted prod), PWA (manifest + sw.js + web-push), Zustand,
TanStack Query, 43 API routes, Node built-in test runner (no Vitest/Jest/RTL),
no CI workflows, no Docker.

This file is gitignored (`.Codex/` is not tracked) — it's local session
tooling, not project documentation. It does not override `AGENTS.md` or any
canonical domain doc.

## DAILY — load every session

| Skill | Why |
| --- | --- |
| `ecc:nextjs-turbopack` | Next 16.2.6 App Router, Turbopack is the default bundler |
| `ecc:react-patterns` | React 19, large `.tsx` surface across `src/app`, `src/components` |
| `ecc:postgres-patterns` | Supabase Postgres is the entire backend; RLS-heavy schema |
| `ecc:database-migrations` | One-at-a-time migration workflow is load-bearing (see `AGENTS.md`, `supabase/MIGRATIONS_AUDIT.md`) |
| `ecc:backend-patterns` | 43 API routes under `src/app/api`, Next.js-route-focused guidance |
| `ecc:frontend-patterns` | Tailwind 4 + Radix + shadcn UI across the app |

## LIBRARY — searchable, invoke on demand

Trigger keywords → skill:

- **slow render / polling cost / background sync** → `ecc:react-performance`
- **new REST resource shape, pagination, versioning** → `ecc:api-design` (overlaps `backend-patterns`; only reach for it on API-shape-specific questions)
- **pre-merge audit, secrets, OWASP** → `ecc:security-review` (normally invoked via `/code-review` instead)
- **Vercel deploy config, envs, build pipeline** → `ecc:deployment-patterns`
- **framer-motion animation work** (1 file today: check current usage before assuming this is still narrow) → `ecc:motion-ui`, `ecc:motion-patterns`
- **React Testing Library / Vitest / Jest ask** → `ecc:react-testing` — **off-stack**, this repo uses `node --test` with `--experimental-strip-types`; confirm the user actually wants a different test runner before applying
- **web-push subscription/threshold work** (`src/lib/push/*`) → `ecc:unified-notifications-ops`
- **marketing page SEO, meta tags, sitemap** → `ecc:seo`

## Not applicable — skip without checking

No repo evidence as of 2026-07-10: `prisma-patterns`, `redis-patterns`,
`mysql-patterns`, `docker-patterns`, `kubernetes-patterns`,
`react-native-patterns`, `e2e-testing`/`browser-qa` (no Playwright config),
and any Python/Go/Rust/Java-stack skills.

## Re-running this audit

Re-run `ecc:agent-sort` if the stack shifts meaningfully (new DB, new test
framework, CI added, mobile app added to this repo). Don't hand-edit this
table from memory — regenerate it with fresh grep evidence.
