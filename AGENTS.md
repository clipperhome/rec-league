# AGENTS.md — Rec League Commissioner Dashboard

## Project
**Goal:** Free web tool for volunteer rec league commissioners to generate schedules, track standings, and share a public league page.
**Stack:** Next.js 15 App Router, TypeScript, Tailwind CSS, Prisma + SQLite (local), Vercel (deploy)
**Status:** experiment → gameology.space candidate

## Architecture
- `/app/setup/` — commissioner creates league + adds teams
- `/app/league/[slug]/` — public page: schedule, standings, results (no login)
- `/app/dashboard/[slug]/` — commissioner view: mark results, handle rainouts
- `/app/api/` — schedule generation, result submission, auth
- `/lib/schedule.ts` — round-robin algorithm (pure function, no DB)
- `/lib/db.ts` — Prisma client singleton
- `/prisma/schema.prisma` — League, Team, Game, Result models

## Key Decisions
- **No passwords** — commissioner gets a magic link sent to email. Public viewers need nothing.
- **Round-robin algorithm** — use the "circle method" (rotate all teams except one fixed). Pure function in lib/schedule.ts, fully testable.
- **Public slug** — each league gets a short readable slug (e.g. `sunday-soccer-2026`), not a UUID
- **SQLite for V1** — simple, no infrastructure needed locally. Swap to Postgres for production deploy.
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
- No real-time updates (polling is fine for V1)
- Don't add features not in PLAN.md scope
- Don't refactor working code mid-task

## Current Task
**Batch 1:**
- Task A: Create Prisma schema with League, Team, Game, Result models + set up db.ts client
- Task B: Implement round-robin schedule algorithm in lib/schedule.ts (pure function, takes array of team names + number of rounds, returns array of matchups with round/home/away)
