# AGENTS.md — Rec League Operations

## Project
**Goal:** Free web tool for volunteer rec leagues: organizers control the official season, team managers submit team-scoped reports, and families use a no-login public page.
**Stack:** Next.js 16 App Router, TypeScript, Tailwind CSS, Prisma + SQLite (local), PostgreSQL (production), Vercel (deploy)
**Status:** product reset verified locally → gameology.space release candidate

## Architecture
- `/app/new/` — organizer creates league, adds teams, and defines game rhythm
- `/app/l/[slug]/` — public page: schedule, standings, results (no login)
- `/app/dashboard/[slug]/` — organizer view: official results, schedules, approvals, managers, settings, archive
- `/app/team/[teamId]/` — team-manager view: team schedule and private reports
- `/app/actions/` — schedule generation, result submission, team management
- `/app/api/` — magic-link verification
- `/lib/schedule.ts` — round-robin algorithm (pure function, no DB)
- `/lib/game-state.ts`, `/lib/game-conflicts.ts`, `/lib/ics.ts` — shared public state, collision, and calendar rules
- `/lib/db.ts` — Prisma client singleton
- `/prisma/sqlite/`, `/prisma/postgresql/` — provider-specific equivalent schemas and migrations

## Key Decisions
- **No passwords** — organizers and invited team managers get one-use magic links. Public viewers need nothing.
- **Managers report; organizers publish** — a manager is scoped to one team and cannot mutate official games or standings without organizer approval.
- **Round-robin algorithm** — use the "circle method" (rotate all teams except one fixed). Pure function in lib/schedule.ts, fully testable.
- **Public slug** — each league gets a short readable slug (e.g. `sunday-soccer-2026`), not a UUID
- **Portable data** — connected leagues use the hosted database as the official copy; local-only leagues use a versioned, human-readable JSON document. SQLite/PostgreSQL are provider-compatible storage, not the user-facing portability format.
- **Spreadsheet boundary** — XLSX/CSV are validated import/export surfaces only, never application state.
- **No auth for public page** — anyone with the URL can see schedule and standings

## What Codex Should Do
- Follow the task order in PLAN.md exactly
- Keep components small and single-purpose
- API routes return clean JSON, handle errors with proper status codes
- Tailwind only — no additional CSS libraries
- Mobile-first layout on the public league page (coaches share this with players)

## What NOT to Do
- No authentication library (NextAuth etc) — magic link only, keep it simple
- No stats beyond win/loss/points/goal-differential
- No real-time updates (60-second public polling is fine for V1)
- Don't add features not in PLAN.md scope
- Don't refactor working code mid-task

## Current Task
**Portability reset:**
- Execute P1–P8 in `PLAN.md` in order. Do not deploy without an explicit user request.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
