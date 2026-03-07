# Rec League Commissioner Dashboard — PLAN.md

## Problem
Volunteer rec league commissioners manage schedules, standings, and rainouts using Google Sheets and group texts. Existing tools (TeamSnap, LeagueApps) cost $100–$150/month — built for organizations, not volunteers.

## Solution (V1)
A free web app where a commissioner can:
1. Create a league (name, sport, game nights, fields)
2. Add teams
3. Auto-generate a round-robin schedule
4. Share a public URL — one page showing schedule, standings, results (mobile-friendly)
5. Mark game results in 10 seconds
6. Handle rainouts with a simple reschedule flow

No auth required for viewers. Commissioner gets a magic-link login (no password needed).

## Stack
Next.js 15, TypeScript, Tailwind, SQLite (via Prisma) for V1 local, Vercel for deploy.

---

## Task Dependency Graph

```
[A] DB schema + Prisma setup
[B] Round-robin schedule algorithm          (independent)
[C] League setup UI (create league, add teams)    (needs A)
[D] Schedule generation API                 (needs A + B)
[E] Public league page (schedule + standings)     (needs A)
[F] Commissioner dashboard (mark results, rainouts) (needs C + D + E)
[G] Magic-link auth                         (needs A)
[H] Deploy to Vercel + env setup            (needs everything)
```

## Tasks

| Task | Depends On | Files Touched | Parallel? |
|------|-----------|---------------|-----------|
| A — DB schema (League, Team, Game, Result) | none | prisma/schema.prisma, lib/db.ts | ✅ start here |
| B — Round-robin algorithm | none | lib/schedule.ts | ✅ parallel with A |
| C — League setup UI | A | app/setup/, components/SetupForm.tsx | after A |
| D — Schedule generation API | A + B | app/api/schedule/ | after A + B |
| E — Public league page | A | app/league/[slug]/, components/Standings.tsx, components/Schedule.tsx | after A |
| F — Commissioner dashboard | C + D + E | app/dashboard/, components/ResultForm.tsx | after C+D+E |
| G — Magic-link auth | A | app/api/auth/, lib/auth.ts | after A, parallel with C+D+E |
| H — Deploy | all | vercel.json, .env.example | last |

## Parallel Batches

- **Batch 1 (run together):** A (DB schema) + B (schedule algorithm)
- **Batch 2 (run together):** C (setup UI) + D (schedule API) + E (public page) + G (magic-link auth)
- **Batch 3 (sequential):** F (commissioner dashboard — needs everything working)
- **Batch 4:** H (deploy)

## Out of Scope (V1)
- Native app
- Payments / premium features
- Player profiles or stats beyond W/L/points
- Multi-division leagues
- Team communication / chat
- Notifications / reminders
